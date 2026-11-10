// Once per environment, after migration 36: gives both logins of every service
// a password, saves them in Infisical, and switches each service's
// DATABASE_URL to its first login. From then on run.js rotates them.
//
//   ADMIN_DATABASE_URL=<the postgres login> node scripts/secret-rotation/bootstrap.js [--only=chat] [--force]
//
// Run it on your own machine. The admin login is used for this only and is
// never stored anywhere by it. --force resets services already switched
// (their running instances keep working only until they redeploy).
// Other settings: as run.js (docs/SECRET_ROTATION.md).
const { connectTo, infisicalFromEnv, required, wait } = require('./environment');
const { loginsOf, newPassword, roleInUrl, setPasswordSql, urlFor } = require('./database-login');
const { ROTATION_PATH, SERVICES, passwordKey, rotatedAtKey, servicePath } = require('./layout');
const { proveLogin } = require('./rotate-database');

async function bootstrapService({ service, secrets, admin, connect, wait, force, now }) {
  const base = await secrets.get(servicePath(service), 'DATABASE_URL');
  if (!base) {
    return `skipped: no DATABASE_URL in ${servicePath(service)} (set up its Railway sync first)`;
  }
  if (/^db\..+\.supabase\.co$/.test(new URL(base).hostname)) {
    // IPv6 only: neither GitHub's runners nor Docker here can reach it.
    throw new Error("DATABASE_URL uses Supabase's direct host; set the session pooler URL (aws-0-<region>.pooler.supabase.com:5432) first");
  }
  const logins = loginsOf(service);
  if (logins.includes(roleInUrl(base)) && !force) return `already on ${roleInUrl(base)}`;

  const { rows } = await admin.query('SELECT rolname FROM pg_roles WHERE rolname = ANY($1)', [logins]);
  if (rows.length !== logins.length) throw new Error('its logins do not exist: apply migration 36_rotating_service_logins first');

  const passwords = {};
  for (const login of logins) {
    passwords[login] = newPassword();
    // Saved first: a login whose password is set but not saved would be lost.
    await secrets.set(ROTATION_PATH, passwordKey(login), passwords[login]);
    await admin.query(setPasswordSql(login, passwords[login]));
  }

  const [first] = logins;
  const url = urlFor(base, first, passwords[first]);
  try {
    await proveLogin(url, connect, wait);
  } catch (error) {
    throw new Error(`${error.message}; DATABASE_URL was not changed`);
  }
  await secrets.set(servicePath(service), 'DATABASE_URL', url);
  await secrets.set(ROTATION_PATH, rotatedAtKey(service), now.toISOString());
  return `switched to ${first}`;
}

// Dashboard runs initialize only legacy URLs; never reset a login already in use.
async function bootstrapIfNeeded({ service, secrets, connect, wait, handover, adminUrl, now }) {
  const base = await secrets.get(servicePath(service), 'DATABASE_URL');
  if (!base) throw new Error(`${service}: DATABASE_URL missing`);
  if (loginsOf(service).includes(roleInUrl(base))) return;
  if (!adminUrl) throw new Error('Set GitHub Actions secret ROTATION_ADMIN_DATABASE_URL to bootstrap database logins');
  await secrets.ensureFolder('/', 'rotation');
  const admin = await connect(adminUrl);
  try {
    await bootstrapService({ service, secrets, admin, connect, wait, force: false, now });
  } finally {
    await admin.end();
  }
  await handover.waitFor([service], { DATABASE_URL: await secrets.get(servicePath(service), 'DATABASE_URL') });
}

async function main() {
  const argv = process.argv.slice(2);
  const only = argv.find((arg) => arg.startsWith('--only='));
  const services = only ? only.slice('--only='.length).split(',') : SERVICES;
  const force = argv.includes('--force');

  const secrets = await infisicalFromEnv();
  await secrets.ensureFolder('/', 'rotation');
  const admin = await connectTo(required('ADMIN_DATABASE_URL'));

  let failures = 0;
  try {
    for (const service of services) {
      try {
        console.log(`${service}: ${await bootstrapService({ service, secrets, admin, connect: connectTo, wait, force, now: new Date() })}`);
      } catch (error) {
        failures++;
        console.log(`${service}: FAILED, ${error.message}`);
      }
    }
  } finally {
    await admin.end();
  }
  if (failures > 0) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.log(`FAILED: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { bootstrapService, bootstrapIfNeeded };
