// Disposable localhost DB + real seven-service HTTP stack. Never loads application .env files.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { fork, execFileSync } = require("node:child_process");
const { Client } = require("pg");
const root = path.resolve(__dirname, "../..");
const reportDir = path.join(root, "docs/full-flow-2026-11-14");
const base = "postgresql://messaging_test:messaging_test@127.0.0.1:55439/";
const database = "app_flow_20261114_test";
const services = [
  "authentication",
  "user",
  "property",
  "chat",
  "payment",
  "notification",
  "api-gateway",
];
const ports = Object.fromEntries(services.map((name, i) => [name, 41401 + i]));
const children = [];
const objects = new Map();
let createdDatabase = false;
let redisCreated = false;
const admin = new Client({ connectionString: base + "messaging_test" });
let owner;
const storage = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method === "PUT") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    objects.set(url.pathname, Buffer.concat(chunks));
    res.end("{}");
  } else if (req.method === "DELETE") {
    for (const key of objects.keys())
      if (
        key === url.pathname ||
        (url.searchParams.has("prefix") && key.startsWith(url.pathname + "/"))
      )
        objects.delete(key);
    res.end("{}");
  } else if (objects.has(url.pathname)) {
    res.setHeader("content-type", "image/jpeg");
    res.end(objects.get(url.pathname));
  } else {
    res.statusCode = 404;
    res.end("{}");
  }
});

async function main() {
  fs.mkdirSync(reportDir, { recursive: true });
  await admin.connect();
  assert.deepEqual(
    (
      await admin.query(
        "SELECT current_database() AS db, current_user AS owner",
      )
    ).rows[0],
    { db: "messaging_test", owner: "messaging_test" },
  );
  assert.equal(
    (
      await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [
        database,
      ])
    ).rowCount,
    0,
    "Inspect leftover fixture before rerun",
  );
  await admin.query(`CREATE DATABASE ${database}`);
  createdDatabase = true;
  owner = new Client({ connectionString: base + database });
  await owner.connect();
  const directory = path.join(root, "prisma/migrations");
  for (const migration of fs
    .readdirSync(directory)
    .filter((name) => /^\d+_/.test(name))
    .sort((a, b) => parseInt(a) - parseInt(b))) {
    await owner.query("BEGIN");
    try {
      await owner.query(
        fs.readFileSync(
          path.join(directory, migration, "migration.sql"),
          "utf8",
        ),
      );
      await owner.query("COMMIT");
    } catch (error) {
      await owner.query("ROLLBACK");
      throw error;
    }
  }
  for (const service of services.slice(0, -1)) {
    await owner.query(
      `ALTER ROLE ${service}_service LOGIN BYPASSRLS PASSWORD 'local-app-flow-only'`,
    );
  }
  execFileSync(
    "docker",
    [
      "create",
      "--name",
      "tilomnov-app-flow-redis",
      "-p",
      "127.0.0.1:16389:6379",
      "redis:7-alpine",
    ],
    { stdio: "pipe" },
  );
  redisCreated = true;
  execFileSync("docker", ["start", "tilomnov-app-flow-redis"], {
    stdio: "pipe",
  });
  await new Promise((resolve) => storage.listen(41408, "127.0.0.1", resolve));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/DATABASE|REDIS|RABBITMQ|SUPABASE|TOKEN|SECRET|PASSWORD|PRIVATE|FIREBASE|GOOGLE|SENTRY|RESEND|SMTP|ABA_|PAYWAY|TURN_|JWT_|MEILI|BREVO|MAILGUN/i.test(
          key,
        ),
    ),
  );
  Object.assign(env, {
    NODE_ENV: "test",
    APP_ENV: "test",
    HOST: "127.0.0.1",
    DATABASE_POOL_MAX: "3",
    REDIS_URL: "redis://127.0.0.1:16389",
    RABBITMQ_URL: "",
    INTERNAL_SERVICE_SECRET: "local-app-flow-internal-secret-not-production",
    CHAT_MESSAGE_SECRET: "local-app-flow-message-encryption-not-production",
    JWT_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    PAYMENT_MODE: "mock",
    SUPABASE_URL: "http://127.0.0.1:41408",
    TURN_URLS: "turn:127.0.0.1:3478",
    TURN_SECRET: "local-turn-fixture-only",
  });
  for (const [name, key] of Object.entries({
    authentication: "AUTH",
    user: "USER",
    property: "PROPERTY",
    chat: "CHAT",
    payment: "PAYMENT",
    notification: "NOTIFICATION",
    "api-gateway": "GATEWAY",
  }))
    env[`${key}_SERVICE_URL`] = `http://127.0.0.1:${ports[name]}`;
  for (const service of services) {
    const role = service === "api-gateway" ? "user" : service;
    const db = new URL(base + database);
    db.username = `${role}_service`;
    db.password = "local-app-flow-only";
    const child = fork(path.join(__dirname, "service.cjs"), [service], {
      cwd: root,
      env: {
        ...env,
        PORT: String(ports[service]),
        DATABASE_URL: db.toString(),
      },
      silent: true,
    });
    children.push(child);
    const log = fs.createWriteStream(path.join(reportDir, `${service}.log`));
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(new Error(`${service} startup timeout; inspect fixture log`)),
        45000,
      );
      child.once("message", (message) => {
        clearTimeout(timeout);
        assert.equal(message, "ready");
        resolve();
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`${service} exited ${code}; inspect fixture log`));
      });
    });
  }
  process.env.QA_PASSWORD_LOCAL = "Local-App-Flow-2026-only!";
  const { runEnvironment } = require("../parity/lib/runner");
  const cases = [...require("../parity/cases")];
  cases.splice(
    cases.findIndex((test) => test.id === "END-01"),
    0,
    require("./plan-flow.cjs")(owner),
  );
  const run = await runEnvironment(
    { name: "local", baseUrl: `http://127.0.0.1:${ports["api-gateway"]}` },
    cases,
  );
  fs.writeFileSync(
    path.join(reportDir, "http-flows.json"),
    JSON.stringify(run, null, 2),
  );
  const counts = {};
  for (const test of run.results)
    counts[test.status] = (counts[test.status] || 0) + 1;
  console.log("HTTP flow results:", counts);
  if (counts.fail || counts.error || counts.skip) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const child of children.reverse()) {
      if (child.exitCode !== null) continue;
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          child.kill();
          resolve();
        }, 5000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        if (child.connected) child.send("stop");
        else child.kill();
      });
    }
    await new Promise((resolve) =>
      storage.listening ? storage.close(resolve) : resolve(),
    );
    if (redisCreated)
      execFileSync("docker", ["rm", "-f", "tilomnov-app-flow-redis"], {
        stdio: "pipe",
      });
    await owner?.end().catch(() => {});
    if (createdDatabase) {
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()",
        [database],
      );
      await admin.query(`DROP DATABASE ${database}`);
    }
    await admin.end().catch(() => {});
    fs.writeFileSync(
      path.join(reportDir, "http-cleanup.json"),
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          stoppedChildren: children.every((child) => child.exitCode !== null),
          disposableDatabaseRemoved: createdDatabase,
          redisContainerRemoved: redisCreated,
          fixtureStorageClosed: !storage.listening,
        },
        null,
        2,
      ),
    );
    console.log("Local flow fixtures cleaned; no production access.");
  });
