const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'apply-migrations.js'), 'utf8');
const stagingUrl = 'postgresql://postgres:staging@localhost/staging';
const productionUrl = 'postgresql://postgres:production@localhost/production';

async function run(args, { production = `DATABASE_URL=${productionUrl}`, inherited = {}, failSql = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-migrations-test-'));
  const connections = [];
  const queries = [];
  const messages = [];
  let exitCode = 0;
  let closed = false;
  try {
    fs.writeFileSync(path.join(root, '.env'), `DATABASE_URL=${stagingUrl}`);
    if (production !== null) fs.writeFileSync(path.join(root, '.env.prod-db'), production);
    for (const name of ['37_subscriptions', '38_test']) {
      const dir = path.join(root, 'prisma', 'migrations', name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'migration.sql'), `SELECT '${name}';`);
    }
    await vm.runInNewContext(script, {
      __dirname: path.join(root, 'scripts'),
      require(name) {
        if (name === '../shared/dist/prisma/database-connection-options')
          return require('../../shared/dist/prisma/database-connection-options');
        if (name !== 'pg') return require(name);
        return {
          Client: class {
            constructor(options) { connections.push(options.connectionString); }
            async connect() {}
            async query(sql) {
              queries.push(sql);
              if (failSql && sql.startsWith('SELECT')) throw new Error('SQL failed');
            }
            async end() { closed = true; }
          },
        };
      },
      process: {
        argv: ['node', 'apply-migrations.js', ...args],
        env: { ...inherited },
        exit(code) { exitCode = code; },
      },
      console: {
        log(message) { messages.push(message); },
        error(message) { messages.push(message); },
      },
    });
    return { connections, queries, messages, exitCode, closed };
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('apply-migrations-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('default command applies staging migrations in order and commits', async () => {
  const result = await run(['37_subscriptions', '38_test']);
  assert.deepEqual(result.connections, [stagingUrl]);
  assert.deepEqual(result.queries, ['BEGIN', "SELECT '37_subscriptions';", "SELECT '38_test';", 'COMMIT']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.closed, true);
});

test('default command preserves an explicitly exported DATABASE_URL', async () => {
  const result = await run(['37_subscriptions'], { inherited: { DATABASE_URL: 'postgresql://localhost/custom' } });
  assert.deepEqual(result.connections, ['postgresql://localhost/custom']);
});

for (const args of [['37_subscriptions', '--prod'], ['--prod', '37_subscriptions']]) {
  test(`production flag selects only production credentials: ${args.join(' ')}`, async () => {
    const result = await run(args, { inherited: { DATABASE_URL: stagingUrl } });
    assert.deepEqual(result.connections, [productionUrl]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.messages.some((message) => message.includes('production using .env.prod-db')));
    assert.ok(result.messages.every((message) => !message.includes(productionUrl)));
  });
}

for (const production of [null, '', 'PAYMENT_DATABASE_URL=postgresql://localhost/service']) {
  test(`production never falls back when its admin URL is missing: ${production}`, async () => {
    const result = await run(['37_subscriptions', '--prod'], { production, inherited: { DATABASE_URL: stagingUrl } });
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.connections, []);
    assert.deepEqual(result.queries, []);
    assert.ok(result.messages.some((message) => message.includes('.env.prod-db')));
  });
}

test('invalid flags and migration names stop before connecting', async () => {
  for (const args of [['37_subscriptions', '--prdo'], ['37_subscriptions', 'missing', '--prod'], ['--prod']]) {
    const result = await run(args);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.connections, []);
  }
});

test('a failed production migration rolls back and closes the connection', async () => {
  const result = await run(['37_subscriptions', '--prod'], { failSql: true });
  assert.deepEqual(result.queries, ['BEGIN', "SELECT '37_subscriptions';", 'ROLLBACK']);
  assert.equal(result.exitCode, 1);
  assert.equal(result.closed, true);
});
