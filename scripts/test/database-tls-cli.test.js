const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cliConnection } = require('../security/prisma-cli.cjs');

test('migration CLI forces hostname and CA verification on remote databases without logging credentials', () => {
  const prepared = cliConnection('postgresql://fixture:fixture@aws-0-ap-southeast-1.pooler.supabase.com/db?sslmode=disable', '/fixture/ca.crt');
  const url = new URL(prepared.url);
  assert.equal(url.searchParams.get('sslmode'), 'verify-full');
  assert.equal(url.searchParams.get('sslrootcert'), '/fixture/ca.crt');
  assert.ok(prepared.ca.includes('BEGIN CERTIFICATE'));
  assert.equal(url.password, 'fixture');
});
test('migration CLI keeps the disposable loopback database usable without TLS', () => {
  const url = 'postgresql://fixture:fixture@127.0.0.1:55439/fixture';
  assert.deepEqual(cliConnection(url, '/unused'), { url, ca: null });
});
