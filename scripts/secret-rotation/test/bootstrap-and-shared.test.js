const { test } = require('node:test');
const assert = require('node:assert');
const { bootstrapService, bootstrapIfNeeded } = require('../bootstrap');
const { urlFor } = require('../database-login');
const { rotateSharedSecrets } = require('../rotate-shared');
const { FakeDatabase, FakeSecrets, noWait } = require('./fakes');
const { SERVICES } = require('../layout');

const HOST = 'postgresql://x.abcref:x@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';

function setUp() {
  const db = new FakeDatabase();
  db.addRole('payment_service_1', null); // created by migration 36, no password yet
  db.addRole('payment_service_2', null);
  const secrets = new FakeSecrets({ '/payment:DATABASE_URL': urlFor(HOST, 'payment_service', 'legacy') });
  const run = (force = false) =>
    bootstrapService({
      service: 'payment',
      secrets,
      admin: db.clientFor('postgres', { admin: true }),
      connect: db.connect,
      wait: noWait,
      force,
      now: new Date(),
    });
  return { db, secrets, run };
}

test('bootstrap gives both logins a password and switches the service to the first', async () => {
  const { db, secrets, run } = setUp();

  assert.strictEqual(await run(), 'switched to payment_service_1');

  const url = secrets.value('/payment', 'DATABASE_URL');
  assert.match(new URL(url).username, /^payment_service_1\.abcref$/);
  assert.ok(db.logsIn(url));
  const second = secrets.value('/rotation', 'PAYMENT_SERVICE_2_PASSWORD');
  assert.ok(db.logsIn(urlFor(HOST, 'payment_service_2', second)));
});

test('bootstrap replaces a postgres pooler URL and preserves its tenant and connection settings', async () => {
  const { db, secrets, run } = setUp();
  const base = urlFor(`${HOST}?sslmode=require`, 'postgres', 'admin-password');
  await secrets.set('/payment', 'DATABASE_URL', base);

  assert.strictEqual(await run(), 'switched to payment_service_1');
  const url = secrets.value('/payment', 'DATABASE_URL');
  assert.strictEqual(decodeURIComponent(new URL(url).username), 'payment_service_1.abcref');
  assert.strictEqual(new URL(url).search, '?sslmode=require');
  assert.ok(db.logsIn(url));
});

test('bootstrap leaves a service that already rotates alone, unless forced', async () => {
  const { secrets, run } = setUp();
  await run();
  const url = secrets.value('/payment', 'DATABASE_URL');

  assert.strictEqual(await run(), 'already on payment_service_1');
  assert.strictEqual(secrets.value('/payment', 'DATABASE_URL'), url);
  assert.strictEqual(await run(true), 'switched to payment_service_1');
});

test('bootstrap asks for migration 36 when the logins do not exist', async () => {
  const { db, run } = setUp();
  db.verifiers.clear();
  await assert.rejects(run(), /migration 36/);
});

test('dashboard bootstrap initializes a legacy login and waits for deployment before rotation', async () => {
  const { db, secrets } = setUp();
  secrets.ensureFolder = async () => {};
  const admin = db.clientFor('postgres', { admin: true });
  let closed = false;
  admin.end = async () => { closed = true; };
  const handovers = [];
  await bootstrapIfNeeded({
    service: 'payment', secrets, adminUrl: 'admin-url', wait: noWait, now: new Date(),
    connect: (url) => url === 'admin-url' ? Promise.resolve(admin) : db.connect(url),
    handover: { waitFor: async (services, expected) => {
      assert.ok(closed);
      assert.ok(db.logsIn(expected.DATABASE_URL));
      handovers.push(services);
    } },
  });
  assert.deepStrictEqual(handovers, [['payment']]);
  assert.match(new URL(secrets.value('/payment', 'DATABASE_URL')).username, /^payment_service_1\./);
});

test('dashboard bootstrap skips initialized logins without an admin credential or any writes', async () => {
  const { secrets, run } = setUp();
  await run();
  secrets.writes.length = 0;
  await bootstrapIfNeeded({ service: 'payment', secrets });
  assert.deepStrictEqual(secrets.writes, []);
});

test('dashboard bootstrap fails before writes when the admin credential is missing', async () => {
  const { secrets } = setUp();
  await assert.rejects(bootstrapIfNeeded({ service: 'payment', secrets }), /ROTATION_ADMIN_DATABASE_URL/);
  assert.deepStrictEqual(secrets.writes, []);
});

test('dashboard bootstrap propagates failed deployment handover', async () => {
  const { db, secrets } = setUp();
  secrets.ensureFolder = async () => {};
  await assert.rejects(bootstrapIfNeeded({
    service: 'payment', secrets, adminUrl: 'admin-url', wait: noWait, now: new Date(),
    connect: (url) => url === 'admin-url' ? Promise.resolve(db.clientFor('postgres', { admin: true })) : db.connect(url),
    handover: { waitFor: async () => { throw new Error('deployment stalled'); } },
  }), /deployment stalled/);
});

test('shared rotation keeps the old internal secret as _PREVIOUS and replaces the encryption key', async () => {
  const secrets = new FakeSecrets({
    ...Object.fromEntries(SERVICES.map((service) => [`/${service}:INTERNAL_SERVICE_SECRET`, 'old-internal'.repeat(4)])),
    '/:INTERNAL_SERVICE_SECRET': 'old-internal'.repeat(4),
    '/authentication:JWT_KEY_ENCRYPTION_KEY': 'old-kek',
  });

  const handovers = [];
  await rotateSharedSecrets({ secrets, handover: { waitFor: async (services, expected) => {
    handovers.push({ services, expected, writes: [...secrets.writes] });
    // Model the configured syncs: only writes to a service folder reach its deployment.
    for (const service of services) {
      for (const [name, value] of Object.entries(expected)) {
        assert.strictEqual(secrets.value(`/${service}`, name), value);
      }
    }
  } } });

  assert.strictEqual(secrets.value('/', 'INTERNAL_SERVICE_SECRET_PREVIOUS'), 'old-internal'.repeat(4));
  const current = secrets.value('/', 'INTERNAL_SERVICE_SECRET');
  assert.ok(current && current !== 'old-internal' && current.length >= 32);
  assert.strictEqual(Buffer.from(secrets.value('/authentication', 'JWT_KEY_ENCRYPTION_KEY'), 'base64').length, 32);
  assert.ok(secrets.value('/rotation', 'SHARED_ROTATED_AT'));
  assert.strictEqual(handovers[1].expected.INTERNAL_SERVICE_SECRET_PREVIOUS, current);
  assert.ok(!handovers[1].writes.includes('/:INTERNAL_SERVICE_SECRET'));
  assert.strictEqual(handovers[2].expected.INTERNAL_SERVICE_SECRET, current);
  // Every service accepts the new key before any service signs with it.
  assert.ok(secrets.writes.indexOf('/:INTERNAL_SERVICE_SECRET_PREVIOUS') < secrets.writes.indexOf('/:INTERNAL_SERVICE_SECRET'));
});

test('a failed service-folder delivery stops before changing the signing secret', async () => {
  const current = 'old-internal'.repeat(4);
  const secrets = new FakeSecrets({ '/:INTERNAL_SERVICE_SECRET': current });
  const set = secrets.set.bind(secrets);
  secrets.set = async (path, name, value) => {
    if (path === '/chat' && name === 'INTERNAL_SERVICE_SECRET_PREVIOUS') throw new Error('sync write failed');
    await set(path, name, value);
  };
  await assert.rejects(rotateSharedSecrets({ secrets, handover: { waitFor: async () => {} } }), /sync write failed/);
  assert.strictEqual(secrets.value('/', 'INTERNAL_SERVICE_SECRET'), current);
  assert.strictEqual(secrets.value('/rotation', 'SHARED_ROTATED_AT'), null);
  assert.ok(!secrets.writes.some((key) => key.endsWith(':INTERNAL_SERVICE_SECRET')));
});
