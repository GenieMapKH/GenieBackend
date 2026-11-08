const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('yaml');

test('containers receive only their own credentials, never the complete env file', () => {
  const config = parse(fs.readFileSync(path.join(__dirname, '../../docker-compose.yml'), 'utf8'), { merge: true });
  for (const [name, service] of Object.entries(config.services)) {
    assert.equal(service.env_file, undefined, `${name} loads the complete secrets file`);
    const env = service.environment ?? {};
    if (name !== 'authentication') {
      for (const secret of ['JWT_KEY_ENCRYPTION_KEY', 'JWT_PUBLIC_KEY', 'BREVO_API_KEY', 'RESEND_API_KEY', 'SMTP_PASS'])
        assert.equal(env[secret], undefined, `${secret} exposed to ${name}`);
    }
    if (!['authentication', 'notification'].includes(name))
      assert.equal(env.FIREBASE_SERVICE_ACCOUNT_JSON, undefined, `Firebase credentials exposed to ${name}`);
    if (name === 'api-gateway') {
      assert.equal(env.DATABASE_URL, undefined);
      assert.equal(env.INTERNAL_SERVICE_SECRET, undefined);
    } else if (name !== 'redis') {
      assert.match(env.DATABASE_URL, /DATABASE_URL:\?/);
      assert.ok(!env.DATABASE_URL.includes('${DATABASE_URL}'), `${name} falls back to admin credentials`);
    }
  }
});
