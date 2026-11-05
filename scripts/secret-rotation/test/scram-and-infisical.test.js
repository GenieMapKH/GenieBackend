const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');
const { matchesVerifier, scramVerifier } = require('../scram');
const { InfisicalSecrets } = require('../infisical');

test('the SCRAM verifier is the one Postgres itself computes', async () => {
  // PGlite is real Postgres compiled to WebAssembly (installed with Prisma).
  const rootRequire = createRequire(path.join(__dirname, '..', '..', '..', 'package.json'));
  const { PGlite } = await import(pathToFileURL(rootRequire.resolve('@electric-sql/pglite')).href);
  const db = await PGlite.create();
  try {
    await db.exec(`SET password_encryption = 'scram-sha-256'; CREATE ROLE probe LOGIN PASSWORD 'pencil-1234';`);
    const { rows } = await db.query(`SELECT rolpassword FROM pg_authid WHERE rolname = 'probe'`);
    const stored = rows[0].rolpassword;

    assert.match(stored, /^SCRAM-SHA-256\$4096:/);
    assert.ok(matchesVerifier('pencil-1234', stored), 'our computation matches Postgres');
    assert.ok(!matchesVerifier('pencil-1235', stored));

    // And Postgres accepts ours as a verifier, storing it unchanged.
    const ours = scramVerifier('another-pass');
    await db.exec(`ALTER ROLE probe PASSWORD '${ours}'`);
    const after = await db.query(`SELECT rolpassword FROM pg_authid WHERE rolname = 'probe'`);
    assert.strictEqual(after.rows[0].rolpassword, ours);
  } finally {
    await db.close();
  }
});

function fakeApi(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, ...init, body: init.body && JSON.parse(init.body) });
    const key = `${init.method} ${new URL(url).pathname}`;
    const [status, body] = routes[key] ?? [404, { message: 'Secret not found' }];
    return new Response(JSON.stringify(body), { status });
  };
  const secrets = new InfisicalSecrets({ apiUrl: 'https://infisical.test/', projectId: 'p1', environment: 'prod', fetchImpl });
  return { secrets, calls };
}

test('Infisical: logs in, then reads a secret without expanding references', async () => {
  const { secrets, calls } = fakeApi({
    'POST /api/v1/auth/universal-auth/login': [200, { accessToken: 'tok' }],
    'GET /api/v4/secrets/DATABASE_URL': [200, { secret: { secretValue: 'postgres://x' } }],
  });
  await secrets.login('id', 'secret');

  assert.strictEqual(await secrets.get('/chat', 'DATABASE_URL'), 'postgres://x');
  const read = calls[1];
  assert.strictEqual(read.headers.authorization, 'Bearer tok');
  const query = new URL(read.url).searchParams;
  assert.strictEqual(query.get('projectId'), 'p1');
  assert.strictEqual(query.get('environment'), 'prod');
  assert.strictEqual(query.get('secretPath'), '/chat');
  assert.strictEqual(query.get('expandSecretReferences'), 'false');
});

test('Infisical: a missing secret reads as null, and setting it creates it', async () => {
  const { secrets, calls } = fakeApi({
    'POST /api/v1/auth/universal-auth/login': [200, { accessToken: 'tok' }],
    'POST /api/v4/secrets/NEW_ONE': [200, {}],
  });
  await secrets.login('id', 'secret');

  assert.strictEqual(await secrets.get('/', 'NEW_ONE'), null);
  await secrets.set('/rotation', 'NEW_ONE', 'v');

  assert.deepStrictEqual(calls.slice(2).map((c) => c.method), ['PATCH', 'POST']);
  assert.deepStrictEqual(calls[3].body, { projectId: 'p1', environment: 'prod', secretPath: '/rotation', secretValue: 'v' });
});

test('Infisical: other errors are reported with status, never with the value sent', async () => {
  const { secrets } = fakeApi({
    'POST /api/v1/auth/universal-auth/login': [200, { accessToken: 'tok' }],
    'PATCH /api/v4/secrets/X': [403, { message: 'You are not allowed' }],
  });
  await secrets.login('id', 'secret');

  await assert.rejects(secrets.set('/', 'X', 'super-secret-value'), (error) => {
    assert.match(error.message, /403 You are not allowed/);
    assert.ok(!error.message.includes('super-secret-value'));
    return true;
  });
});
