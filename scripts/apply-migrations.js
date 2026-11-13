const { databaseConnectionOptions } = require('../shared/dist/prisma/database-connection-options');
// Applies migrations using .env (staging/default) or .env.prod-db (--prod).
//
//   node scripts/apply-migrations.js 7_user_profile_fields 8_refresh_token_sessions
//   node scripts/apply-migrations.js 37_subscriptions --prod
//
// Why this exists: `prisma migrate deploy` cannot use the pooled DATABASE_URL
// this project runs on, and nothing applies migrations on deploy. Every
// migration here is written to be safe to run twice (IF NOT EXISTS), so
// re-running one that is already applied changes nothing.
//
// All the named migrations run in ONE transaction: either every one of them
// is applied, or the database is left exactly as it was.
//
// Apply a migration BEFORE starting a backend build that needs it: the
// services read the new columns as soon as they start.
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

async function main() {
  const args = process.argv.slice(2);
  const prod = args.includes('--prod');
  const names = args.filter((arg) => arg !== '--prod');
  const unknownOption = names.find((name) => name.startsWith('-'));
  if (unknownOption) throw new Error(`Unknown option: ${unknownOption}`);
  if (names.length === 0) {
    const available = fs.readdirSync(MIGRATIONS_DIR).filter((name) => /^\d+_/.test(name));
    console.error(`Name the migrations to apply, in order. Available:\n  ${available.join('\n  ')}`);
    return process.exit(1);
  }
  const envFile = prod ? '.env.prod-db' : '.env';
  // Production must never inherit a staging DATABASE_URL from the shell or .env.
  const env = prod ? {} : process.env;
  const loaded = dotenv.config({
    path: path.join(__dirname, '..', envFile),
    processEnv: env,
    quiet: true,
  });
  if (prod && loaded.error) throw new Error(`Cannot read ${envFile}`);
  if (!env.DATABASE_URL) {
    throw new Error(`DATABASE_URL is not set in ${envFile} (use a postgres/admin login, not a service login)`);
  }

  // Read every file first, so a typo in a name stops before anything runs.
  const migrations = names.map((name) => ({
    name,
    sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'),
  }));

  console.log(`Applying migrations to ${prod ? 'production' : 'staging/default'} using ${envFile}`);
  const client = new Client(databaseConnectionOptions(env.DATABASE_URL));
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const migration of migrations) {
      await client.query(migration.sql);
      console.log(`applied ${migration.name}`);
    }
    await client.query('COMMIT');
    console.log('done');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Nothing was changed: ${error.message}`);
  process.exit(1);
});
