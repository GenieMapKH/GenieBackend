// Only the disposable messaging fixture is reachable here; no .env or provider credentials are loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const root = path.resolve(__dirname, '../..');
const name = 'security_remediation_20261113_test';
const base = 'postgresql://messaging_test:messaging_test@127.0.0.1:55439/';

async function run() {
  const admin = new Client({ connectionString: base + 'messaging_test' });
  await admin.connect();
  let created = false;
  try {
    assert.deepEqual((await admin.query('SELECT current_database() AS db, current_user AS owner')).rows[0], { db: 'messaging_test', owner: 'messaging_test' });
    assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount, 0, 'A previous fixture remains; inspect it before running again');
    await admin.query(`CREATE DATABASE ${name}`); created = true;
    const db = new Client({ connectionString: base + name });
    await db.connect();
    try {
      const directory = path.join(root, 'prisma/migrations');
      for (const migration of fs.readdirSync(directory).filter((entry) => /^\d+_/.test(entry)).sort((a, b) => parseInt(a) - parseInt(b))) {
        await db.query('BEGIN');
        try { await db.query(fs.readFileSync(path.join(directory, migration, 'migration.sql'), 'utf8')); await db.query('COMMIT'); }
        catch (error) { await db.query('ROLLBACK'); throw new Error(`Fixture migration ${migration}: ${error.message}`); }
      }
    } finally { await db.end(); }
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/DATABASE|REDIS|RABBITMQ|SUPABASE|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|SERVICE_ACCOUNT|API_KEY/i.test(key)));
    const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'qa/security/security.integration.test.cjs'], {
      cwd: root, env: { ...env, DATABASE_URL: base + name, DATABASE_POOL_MAX: '8', NODE_ENV: 'test' }, encoding: 'utf8', timeout: 180000,
    });
    fs.mkdirSync(path.join(root, 'docs/security-remediation-2026-11-13'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/security-remediation-2026-11-13/integration-tests.txt'), `${result.stdout || ''}\n${result.stderr || ''}`);
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0, 'Security integration tests failed');
  } finally {
    if (created) {
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()', [name]);
      await admin.query(`DROP DATABASE ${name}`);
      console.log('Cleanup verified: disposable security database removed; production untouched.');
    }
    await admin.end();
  }
}
run().catch((error) => { console.error(error.message); process.exitCode = 1; });
