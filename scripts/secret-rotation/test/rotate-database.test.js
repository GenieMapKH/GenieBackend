const { test } = require('node:test');
const assert = require('node:assert');
const { urlFor } = require('../database-login');
const { rotateDatabaseLogin, RotationBlocked } = require('../rotate-database');
const { FakeDatabase, FakeSecrets, noWait } = require('./fakes');

const HOST = 'postgresql://x.abcref:x@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';

/** The chat service, bootstrapped and running on its first login. */
function setUp() {
  const db = new FakeDatabase();
  db.addRole('chat_service_1', 'one');
  db.addRole('chat_service_2', 'two');
  const secrets = new FakeSecrets({
    '/chat:DATABASE_URL': urlFor(HOST, 'chat_service_1', 'one'),
    '/rotation:CHAT_SERVICE_1_PASSWORD': 'one',
    '/rotation:CHAT_SERVICE_2_PASSWORD': 'two',
  });
  const rotate = () => rotateDatabaseLogin({ service: 'chat', secrets, connect: db.connect, wait: noWait });
  return { db, secrets, rotate };
}

test('switches the service to its other login, with a new password that works', async () => {
  const { db, secrets, rotate } = setUp();
  const before = secrets.value('/chat', 'DATABASE_URL');

  assert.strictEqual(await rotate(), 'chat_service_2');

  const after = secrets.value('/chat', 'DATABASE_URL');
  assert.match(new URL(after).username, /^chat_service_2\.abcref$/);
  assert.ok(db.logsIn(after), 'the new DATABASE_URL logs in');
  assert.ok(db.logsIn(before), 'the old one keeps working until the next rotation');
  assert.notStrictEqual(secrets.value('/rotation', 'CHAT_SERVICE_2_PASSWORD'), 'two');
  assert.ok(secrets.value('/rotation', 'CHAT_ROTATED_AT'));
});

test('alternates between the two logins', async () => {
  const { db, secrets, rotate } = setUp();
  await rotate();
  assert.strictEqual(await rotate(), 'chat_service_1');
  assert.ok(db.logsIn(secrets.value('/chat', 'DATABASE_URL')));
  assert.strictEqual(await rotate(), 'chat_service_2');
});

test('never sends the plain password to the database', async () => {
  const { db, secrets, rotate } = setUp();
  await rotate();
  const password = secrets.value('/rotation', 'CHAT_SERVICE_2_PASSWORD');
  assert.ok(db.statements.every((sql) => !sql.includes(password)));
});

test('stops, changing nothing, while a service still runs on the login it would change', async () => {
  const { db, secrets, rotate } = setUp();
  db.sessions.set('chat_service_2', 3);
  const url = secrets.value('/chat', 'DATABASE_URL');

  await assert.rejects(rotate(), RotationBlocked);

  assert.strictEqual(secrets.value('/chat', 'DATABASE_URL'), url);
  assert.ok(db.logsIn(urlFor(HOST, 'chat_service_2', 'two')), 'its password is untouched');
});

test('refuses a service that was never switched to its rotating logins', async () => {
  const { secrets, rotate } = setUp();
  secrets.values.set('/chat:DATABASE_URL', urlFor(HOST, 'chat_service', 'legacy'));
  await assert.rejects(rotate(), /bootstrap/);
});

test('does not switch the service while the new password is not accepted yet, and recovers next run', async () => {
  const { db, secrets, rotate } = setUp();
  const url = secrets.value('/chat', 'DATABASE_URL');
  db.poolerLag = 99;

  await assert.rejects(rotate(), /not switched/);
  assert.strictEqual(secrets.value('/chat', 'DATABASE_URL'), url);

  db.poolerLag = 0;
  db.lagging.clear();
  assert.strictEqual(await rotate(), 'chat_service_2');
  assert.ok(db.logsIn(secrets.value('/chat', 'DATABASE_URL')));
});

test('finishes after a run that changed the password but stopped before saving it', async () => {
  const { db, secrets, rotate } = setUp();
  // What such a run leaves behind: the pending password is in use, the saved one is stale.
  secrets.values.set('/rotation:CHAT_SERVICE_2_PASSWORD_PENDING', 'interrupted');
  await db.clientFor('chat_service_2').query(
    `ALTER ROLE "chat_service_2" PASSWORD '${require('../scram').scramVerifier('interrupted')}'`,
  );

  assert.strictEqual(await rotate(), 'chat_service_2');
  assert.ok(db.logsIn(secrets.value('/chat', 'DATABASE_URL')));
});

test('a login is only ever changed by itself', async () => {
  const { db, rotate } = setUp();
  await rotate(); // FakeDatabase refuses ALTER ROLE on another role
  assert.ok(db.statements.some((sql) => sql.startsWith('ALTER ROLE "chat_service_2"')));
});
