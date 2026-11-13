// Uses only the disposable local containers in this directory; never loads .env.
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { Pool } = require("pg");
const { PrismaService } = require("../../shared/dist/prisma/prisma.service");
const { MessageBus } = require("../../shared/dist/messaging/message-bus");
const { MessageStore } = require("../../shared/dist/messaging/message-store");
const {
  MESSAGE_ROUTES,
  SERVICES,
} = require("../../shared/dist/messaging/message-contracts");
const {
  currentServiceMessage,
} = require("../../shared/dist/messaging/message-context");
const {
  messageContext,
} = require("../../shared/dist/messaging/message-context");
const {
  PushDeliveryService,
} = require("../../notification/dist/notifications/delivery/push-delivery.service");
const {
  RabbitTransport,
  sourceExchange,
  queueName,
  deadQueueName,
  retryQueueName,
  RETRY_DELAYS_MS,
} = require("../../shared/dist/messaging/rabbit-transport");
const {
  InternalNotificationsController,
} = require("../../notification/dist/notifications/internal/internal-notifications.controller");
const {
  OrderEmailController,
} = require("../../authentication/dist/auth/mail/order-email.controller");
const {
  SignInEmailConsumer,
} = require("../../authentication/dist/auth/mail/sign-in-email.consumer");

const pgUrl =
  "postgresql://messaging_test:messaging_test@127.0.0.1:55439/messaging_test";
const rabbitUrl =
  "amqp://messaging_test:messaging_test@127.0.0.1:5679/tilomnov-test";
const db = new Pool({ connectionString: pgUrl, max: 10 });
const buses = [];
const clients = [];
const sources = new Map();
const attempts = new Map();
const behaviors = new Map();
const compose = (...args) =>
  promisify(execFile)(
    "docker",
    ["compose", "-f", resolve(__dirname, "docker-compose.yml"), ...args],
    { timeout: 90000 },
  );
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let transport;
let deliveredEmails = 0;

async function until(check, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(100);
  }
  throw new Error("Timed out waiting for messaging state");
}
const count = async (id) =>
  Number(
    (
      await db.query(
        "SELECT count(*) FROM public.messaging_test_effects WHERE event_id = $1",
        [id],
      )
    ).rows[0].count,
  );
function message(patch = {}) {
  return {
    id: randomUUID(),
    version: 1,
    source: "chat",
    destination: "notification",
    type: "notification.chat-message.v1",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    payload: {
      recipientId: randomUUID(),
      senderId: randomUUID(),
      senderName: "Test sender",
      messageId: randomUUID(),
      ciphertext: "sealed",
      nonce: "nonce",
    },
    ...patch,
  };
}
async function record(kind, payload) {
  const job = currentServiceMessage();
  assert.ok(job, "handler runs inside the message context");
  attempts.set(job.id, (attempts.get(job.id) ?? 0) + 1);
  const behavior = behaviors.get(job.id);
  if (behavior) await behavior(attempts.get(job.id));
  await db.query(
    "INSERT INTO public.messaging_test_effects(event_id, kind, body) VALUES ($1, $2, $3)",
    [job.id, kind, payload],
  );
  return { sent: 1, failed: 0, removed: 0 };
}
async function makeBus(service) {
  const prisma = new PrismaService();
  clients.push(prisma);
  await prisma.$connect();
  const bus = new MessageBus(prisma, service);
  buses.push(bus);
  if (service === "notification") {
    new InternalNotificationsController(
      { notify: (event) => record("chat", event) },
      { notify: (event) => record("sign-in", event) },
      {},
      { notify: (label) => record(label, {}) },
      { notify: (event) => record("expiry", event) },
      bus,
    ).onModuleInit();
  }
  if (service === "authentication") {
    const mail = {
      deliver: async () => {
        deliveredEmails++;
        return true;
      },
    };
    new OrderEmailController(prisma, mail, bus).onModuleInit();
    new SignInEmailConsumer(bus, prisma, mail).onModuleInit();
  }
  for (const [type, [, destination]] of Object.entries(MESSAGE_ROUTES)) {
    if (destination === service && !bus.handlers.has(type))
      bus.handle(type, async (payload) => {
        await record(type, payload);
      });
  }
  await bus.onApplicationBootstrap();
  return { bus, prisma };
}
async function rawChannel() {
  await until(() => transport.connection.isConnected());
  return transport.connection.connection.createChannel();
}
async function takeDead(id) {
  const channel = await rawChannel();
  try {
    const found = await channel.get(deadQueueName("notification"), {
      noAck: false,
    });
    if (!found) return false;
    if (found.properties.messageId === id) {
      channel.ack(found);
      return found;
    }
    channel.nack(found, false, true);
    return false;
  } finally {
    await channel.close();
  }
}

before(
  async () => {
    process.env.DATABASE_URL = pgUrl;
    process.env.DATABASE_POOL_MAX = "2";
    process.env.RABBITMQ_URL = rabbitUrl;
    await db.query(
      `CREATE SCHEMA IF NOT EXISTS account; CREATE SCHEMA IF NOT EXISTS listing; CREATE SCHEMA IF NOT EXISTS chat; CREATE SCHEMA IF NOT EXISTS payment; CREATE SCHEMA IF NOT EXISTS notification`,
    );
    for (const service of SERVICES) {
      await db.query(
        `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${service}_service') THEN CREATE ROLE ${service}_service BYPASSRLS; END IF; END $$`,
      );
    }
    const sql = readFileSync(
      resolve(
        __dirname,
        "../../prisma/migrations/48_service_messaging/migration.sql",
      ),
      "utf8",
    );
    await db.query(sql);
    await db.query(sql); // Migration is safe to rerun.
    for (const schema of [
      "account",
      "listing",
      "chat",
      "payment",
      "notification",
    ]) {
      await db.query(
        `TRUNCATE ${schema}.service_outbox, ${schema}.service_message_receipts`,
      );
    }
    await db.query(`CREATE TABLE IF NOT EXISTS public.messaging_test_effects(id bigserial PRIMARY KEY, event_id uuid NOT NULL, kind text NOT NULL, body jsonb NOT NULL); TRUNCATE public.messaging_test_effects;
    CREATE TABLE IF NOT EXISTS account.users(id uuid PRIMARY KEY, email text);
    CREATE TABLE IF NOT EXISTS public.messaging_test_business(id uuid PRIMARY KEY)`);
    transport = new RabbitTransport(
      rabbitUrl,
      async () => {},
      () => {},
    );
    await transport.channel.waitForConnect();
    const channel = await rawChannel();
    for (const service of SERVICES) {
      await channel.purgeQueue(queueName(service));
      await channel.purgeQueue(deadQueueName(service));
      for (let i = 0; i < RETRY_DELAYS_MS.length; i++)
        await channel.purgeQueue(retryQueueName(service, i));
    }
    await channel.close();
    for (const service of SERVICES)
      sources.set(service, await makeBus(service));
  },
  { timeout: 60000 },
);

after(async () => {
  await Promise.allSettled(buses.map((bus) => bus.onModuleDestroy()));
  await transport?.close();
  await Promise.allSettled(clients.map((client) => client.$disconnect()));
  await db.end();
});

test("migration grants only owning service roles access to each outbox", async () => {
  const result =
    await db.query(`SELECT has_table_privilege('chat_service','chat.service_outbox','INSERT') AS own,
    has_table_privilege('chat_service','payment.service_outbox','SELECT') AS other,
    has_table_privilege('user_service','account.service_outbox','INSERT') AS account`);
  assert.deepEqual(result.rows[0], { own: true, other: false, account: true });
});

test("outbox commits and rolls back with its business write, and deduplicates keys", async () => {
  const { prisma, bus } = sources.get("chat");
  const businessId = randomUUID();
  const job = message();
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO public.messaging_test_business (id) VALUES (${businessId}::uuid)`;
      await bus.enqueue(job.type, job.payload, { key: businessId, tx });
      throw new Error("business validation failed");
    }),
  );
  assert.equal(
    (
      await db.query(
        "SELECT id FROM public.messaging_test_business WHERE id = $1",
        [businessId],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await db.query(
        "SELECT id FROM chat.service_outbox WHERE dedup_key = $1",
        [businessId],
      )
    ).rowCount,
    0,
  );
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO public.messaging_test_business (id) VALUES (${businessId}::uuid)`;
    await bus.enqueue(job.type, job.payload, { key: businessId, tx });
    await bus.enqueue(job.type, job.payload, { key: businessId, tx });
  });
  const rows = await db.query(
    "SELECT id FROM chat.service_outbox WHERE dedup_key = $1",
    [businessId],
  );
  assert.equal(rows.rowCount, 1);
  await until(async () => (await count(rows.rows[0].id)) === 1);
});

test("all notification command types use the existing validated handlers", async () => {
  const id = randomUUID();
  const events = [
    ["chat", "notification.chat-message.v1", message().payload],
    [
      "authentication",
      "notification.sign-in.v1",
      { userId: id, sessionId: randomUUID() },
    ],
    [
      "property",
      "notification.saved-search-match.v1",
      {
        propertyId: id,
        title: "Test",
        recipients: [{ userId: id, searchName: "Home" }],
      },
    ],
    [
      "property",
      "notification.followed-listing.v1",
      { propertyId: id, title: "Test", ownerName: "Owner", recipients: [id] },
    ],
    [
      "property",
      "notification.saved-listing-update.v1",
      { propertyId: id, title: "Test", kind: "sold", recipients: [id] },
    ],
    [
      "payment",
      "notification.publishing-expiry.v1",
      {
        userId: id,
        kind: "listing",
        propertyId: id,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    ],
  ];
  const ids = [];
  for (const [source, type, payload] of events) {
    const job = message({ source, type, payload });
    ids.push(job.id);
    await transport.publish(job);
  }
  await until(async () =>
    (await Promise.all(ids.map(count))).every((value) => value === 1),
  );
});

test("order confirmations and security emails are consumed by authentication", async () => {
  const userId = randomUUID();
  await db.query("INSERT INTO account.users(id, email) VALUES ($1, $2)", [
    userId,
    "local@example.invalid",
  ]);
  const initial = deliveredEmails;
  await sources.get("payment").bus.enqueue("authentication.order-email.v1", {
    userId,
    transactionId: randomUUID(),
    item: "gold",
    amount: 8.9,
    periodStart: new Date().toISOString(),
  });
  await sources
    .get("authentication")
    .bus.enqueue("authentication.sign-in-email.v1", {
      userId,
      deviceName: "Local",
      platform: "Test",
      signedInAt: new Date().toISOString(),
    });
  await until(() => deliveredEmails === initial + 2);
});

test('a burst of 100 accepted jobs drains without lost or duplicated handler effects', async () => {
  const jobs = Array.from({ length: 100 }, () => message());
  await Promise.all(jobs.map((job) => sources.get('chat').bus.enqueue(job.type, job.payload, { key: `burst:${job.id}` })));
  const rows = await db.query('SELECT id FROM chat.service_outbox WHERE dedup_key = ANY($1::text[])', [jobs.map((job) => `burst:${job.id}`)]);
  assert.equal(rows.rowCount, 100);
  const ids = rows.rows.map((row) => row.id);
  const delivered = await until(async () => {
    const result = await db.query('SELECT count(*) AS total, count(DISTINCT event_id) AS distinct_ids FROM public.messaging_test_effects WHERE event_id = ANY($1::uuid[])', [ids]);
    return Number(result.rows[0].distinct_ids) === 100 ? result.rows[0] : false;
  }, 45000);
  assert.equal(Number(delivered.total), 100);
});

test("concurrent duplicate deliveries across receiver replicas run a handler once", async () => {
  const replica = await makeBus("notification");
  const job = message();
  behaviors.set(job.id, () => sleep(600));
  await Promise.all([transport.publish(job), transport.publish(job)]);
  await until(async () => (await count(job.id)) === 1);
  await sleep(6500); // A duplicate parked on the first retry queue must also see its receipt.
  assert.equal(await count(job.id), 1);
  assert.equal(attempts.get(job.id), 1);
  await replica.bus.onModuleDestroy();
});

test("partial push retries retain successful device receipts in PostgreSQL", async () => {
  const job = message();
  const batches = [];
  let attempt = 0;
  const sender = {
    send: async (pushes) => {
      batches.push(pushes.map((push) => push.token));
      return attempt++ === 0 ? ["sent", "failed"] : ["sent"];
    },
  };
  const delivery = new PushDeliveryService(
    sender,
    { forget: async () => 0 },
    sources.get("notification").prisma,
  );
  const targets = [0, 1].map((id) => ({
    id: randomUUID(),
    token: `test-${id}`,
    platform: "android",
    locale: "en",
  }));
  const content = () => ({
    data: { type: "test" },
    channel: "security",
    urgent: true,
  });
  const first = await messageContext.run(job, () =>
    delivery.deliver(targets, content),
  );
  assert.equal(first.failed, 1);
  const retry = await messageContext.run(job, () =>
    delivery.deliver(targets, content),
  );
  assert.equal(retry.failed, 0);
  assert.deepEqual(batches, [["test-0", "test-1"], ["test-1"]]);
  const receipts = await db.query(
    "SELECT step FROM notification.service_message_receipts WHERE event_id = $1",
    [job.id],
  );
  assert.equal(receipts.rowCount, 2);
});

test("transient failure retries after a delay and then succeeds", async () => {
  const job = message();
  let failedAt = 0;
  behaviors.set(job.id, (attempt) => {
    if (attempt === 1) {
      failedAt = Date.now();
      throw new Error("provider unavailable");
    }
  });
  await transport.publish(job);
  await until(async () => (await count(job.id)) === 1);
  assert.equal(attempts.get(job.id), 2);
  assert.ok(Date.now() - failedAt >= RETRY_DELAYS_MS[0] - 250);
});

test("invalid payloads and malformed JSON go to the dead-letter queue without handler effects", async () => {
  const invalid = message({ payload: { userId: "invalid" } });
  await transport.publish(invalid);
  const dead = await until(() => takeDead(invalid.id));
  assert.equal(dead.properties.headers["x-failure-reason"], "invalid-message");
  assert.equal(await count(invalid.id), 0);
  const id = randomUUID();
  await transport.send("", queueName("notification"), Buffer.from("{bad"), {
    messageId: id,
  });
  const malformed = await until(() => takeDead(id));
  assert.equal(malformed.content.toString(), "{bad");
});

test("expired messages never trigger a delayed notification", async () => {
  const job = message({
    createdAt: new Date(Date.now() - 120000).toISOString(),
    expiresAt: new Date(Date.now() - 60000).toISOString(),
  });
  await transport.publish(job);
  await sleep(750);
  assert.equal(await count(job.id), 0);
  assert.equal(attempts.get(job.id), undefined);
});

test("mandatory publishing rejects unroutable work instead of treating a broker confirm as delivery", async () => {
  await assert.rejects(
    transport.send(
      sourceExchange("chat"),
      "missing-consumer",
      Buffer.from("{}"),
      { messageId: randomUUID() },
    ),
    /Unroutable/,
  );
});

test("failed outbox publication stays pending and concurrent dispatchers skip locked rows", async () => {
  await sources.get("chat").bus.onModuleDestroy();
  const { prisma } = sources.get("chat");
  const store = new MessageStore(prisma, "chat");
  const job = message();
  const key = randomUUID();
  // Its background dispatcher is stopped so only the two workers below can claim this row.
  await store.enqueue(job, key);
  let publications = 0;
  await Promise.all([
    store.dispatchOne(async () => {
      publications++;
      await sleep(200);
    }),
    store.dispatchOne(async () => {
      publications++;
    }),
  ]);
  assert.equal(publications, 1);
  const failed = message();
  await store.enqueue(failed, randomUUID());
  await store.dispatchOne(() =>
    Promise.reject(new Error("broker unavailable")),
  );
  const result = await db.query(
    "SELECT published_at, attempts, next_attempt_at > now() AS deferred FROM chat.service_outbox WHERE id = $1",
    [failed.id],
  );
  assert.equal(result.rows[0].published_at, null);
  assert.equal(result.rows[0].attempts, 1);
  assert.equal(result.rows[0].deferred, true);
  sources.set("chat", await makeBus("chat"));
});

test("channel closure reconnects the receiver and subsequent jobs still arrive", async () => {
  const receiver = sources.get("notification").bus.transport;
  await receiver.channel._channel.close();
  const job = message();
  await transport.publish(job);
  await until(async () => (await count(job.id)) === 1, 30000);
});

test("a channel protocol error is handled and consumption recovers", async () => {
  const channel = sources.get("notification").bus.transport.channel._channel;
  await assert.rejects(channel.checkQueue(`missing-${randomUUID()}`));
  const job = message();
  await transport.publish(job);
  await until(async () => (await count(job.id)) === 1, 30000);
});

test("shutdown waits for an active delivery and commits its receipt before closing", async () => {
  const job = message();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  behaviors.set(job.id, () => gate);
  await transport.publish(job);
  await until(() => attempts.has(job.id));
  let stopped = false;
  const shutdown = sources
    .get("notification")
    .bus.onModuleDestroy()
    .then(() => {
      stopped = true;
    });
  await sleep(100);
  assert.equal(stopped, false);
  release();
  await shutdown;
  assert.equal(await count(job.id), 1);
  const receipt = await db.query(
    "SELECT event_id FROM notification.service_message_receipts WHERE event_id = $1 AND step = ''",
    [job.id],
  );
  assert.equal(receipt.rowCount, 1);
  sources.set("notification", await makeBus("notification"));
});

test(
  "broker restart preserves queued messages and drains jobs accepted while it was offline",
  { timeout: 90000 },
  async () => {
    // Park a notification with no running receiver before restarting the broker.
    await sources.get("notification").bus.onModuleDestroy();
    const queued = message();
    await transport.publish(queued);
    await compose("stop", "rabbitmq");
    const coldStart = await makeBus("chat");
    const key = randomUUID();
    await coldStart.bus.enqueue(
      "notification.chat-message.v1",
      message().payload,
      { key },
    );
    const pending = await db.query(
      "SELECT id, published_at FROM chat.service_outbox WHERE dedup_key = $1",
      [key],
    );
    assert.equal(pending.rows[0].published_at, null);
    await compose("up", "-d", "--wait", "rabbitmq");
    const replacement = await makeBus("notification");
    sources.set("notification", replacement);
    await until(
      async () =>
        (await count(queued.id)) === 1 &&
        (await count(pending.rows[0].id)) === 1,
      45000,
    );
  },
);

test(
  "exhausted retries preserve the message in the dead-letter queue",
  { timeout: 200000 },
  async () => {
    const job = message();
    behaviors.set(job.id, () => {
      throw new Error("permanent provider outage");
    });
    await transport.publish(job);
    const dead = await until(() => takeDead(job.id), 190000);
    assert.equal(attempts.get(job.id), 4);
    assert.equal(
      dead.properties.headers["x-failure-reason"],
      "retry-exhausted",
    );
    assert.equal(JSON.parse(dead.content.toString()).id, job.id);
    assert.equal(await count(job.id), 0);
  },
);
