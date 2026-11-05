// Rotates one service's database password without downtime.
//
// A service runs on one of its two logins. The other one gets a new password,
// is proven to work, and becomes the service's DATABASE_URL (one secret, so the
// Railway sync never sees a new user with an old password). The login left
// behind keeps its password until the next rotation, so a service that has not
// redeployed yet keeps working.
//
// The job logs in as the login it changes and changes only that login's own
// password: no stored credential can change anybody else's.
const { loginsOf, newPassword, roleInUrl, setPasswordSql, urlFor } = require('./database-login');
const { ROTATION_PATH, passwordKey, pendingKey, rotatedAtKey, servicePath } = require('./layout');

/** A rotation refused on purpose, before anything changed. */
class RotationBlocked extends Error {}

/**
 * @param service  e.g. 'chat'
 * @param secrets  `InfisicalSecrets` (get/set)
 * @param connect  `(url) => Promise<pg.Client>` connected
 * @param wait     `(ms) => Promise` between login retries
 * @returns the login the service now uses
 */
async function rotateDatabaseLogin({ service, secrets, connect, wait, now = new Date() }) {
  const base = await secrets.get(servicePath(service), 'DATABASE_URL');
  if (!base) throw new RotationBlocked(`${service}: no DATABASE_URL in ${servicePath(service)}`);

  const [first, second] = loginsOf(service);
  const active = roleInUrl(base);
  if (active !== first && active !== second) {
    throw new RotationBlocked(`${service}: runs as "${active}", not one of its rotating logins. Run bootstrap.js first.`);
  }
  const target = active === first ? second : first;
  const password = newPassword();

  const client = await logInAs(target, base, secrets, connect);
  try {
    await refuseIfInUse(client, target);
    // Saved before the change: if this run stops after it, the next one can still log in.
    await secrets.set(ROTATION_PATH, pendingKey(target), password);
    await client.query(setPasswordSql(target, password));
  } finally {
    await client.end();
  }

  try {
    await proveLogin(urlFor(base, target, password), connect, wait);
  } catch (error) {
    throw new Error(`${error.message}. The service was not switched; the next run retries.`);
  }
  await secrets.set(ROTATION_PATH, passwordKey(target), password);
  await secrets.set(servicePath(service), 'DATABASE_URL', urlFor(base, target, password));
  await secrets.set(ROTATION_PATH, rotatedAtKey(service), now.toISOString());
  return target;
}

/** With the login's saved password, or the one an interrupted run was setting. */
async function logInAs(role, base, secrets, connect) {
  const candidates = [
    await secrets.get(ROTATION_PATH, passwordKey(role)),
    await secrets.get(ROTATION_PATH, pendingKey(role)),
  ].filter(Boolean);
  let lastError = new Error('no saved password');
  for (const password of candidates) {
    try {
      return await connect(urlFor(base, role, password));
    } catch (error) {
      lastError = error; // Try the next one.
    }
  }
  throw new RotationBlocked(
    `cannot log in as ${role} (${lastError.message}). If the database is reachable, its saved password is wrong: reset it with bootstrap.js.`,
  );
}

/**
 * Something still connected as the login about to change is a service that
 * never redeployed onto its current login. Changing the password would cut it
 * off at its next new connection, so stop here instead.
 */
async function refuseIfInUse(client, role) {
  const { rows } = await client.query(
    'SELECT count(*)::int AS sessions FROM pg_stat_activity WHERE usename = $1 AND pid <> pg_backend_pid()',
    [role],
  );
  if (rows[0].sessions > 0) {
    throw new RotationBlocked(
      `${role} still has ${rows[0].sessions} open connection(s): a service has not redeployed since the last rotation. Nothing was changed.`,
    );
  }
}

/** A pooler may take a moment to notice a new password, so a few tries. */
async function proveLogin(url, connect, wait, attempts = 6) {
  for (let attempt = 1; ; attempt++) {
    try {
      const client = await connect(url);
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (error) {
      if (attempt >= attempts) {
        throw new Error(`the new password does not work yet (${error.message})`);
      }
      await wait(5000 * attempt);
    }
  }
}

module.exports = { rotateDatabaseLogin, proveLogin, RotationBlocked };
