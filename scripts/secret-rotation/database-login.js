// The two logins of each service, and how they appear in a DATABASE_URL.
const { randomBytes } = require('crypto');
const { scramVerifier } = require('./scram');

/** `<service>_service_1` and `_2` (migration 36). */
function loginsOf(service) {
  return [`${service}_service_1`, `${service}_service_2`];
}

/**
 * The role a URL logs in as. On Supabase's pooler the user name is
 * `<role>.<project ref>`; role names never contain a dot.
 */
function roleInUrl(url) {
  return decodeURIComponent(new URL(url).username).split('.')[0];
}

/** `base` (host, database, options) logging in as `role` with `password`, keeping a pooler's `.<project ref>`. */
function urlFor(base, role, password) {
  const url = new URL(base);
  const user = decodeURIComponent(url.username);
  const tenant = user.includes('.') ? user.slice(user.indexOf('.')) : '';
  url.username = encodeURIComponent(role + tenant);
  url.password = encodeURIComponent(password);
  return url.toString();
}

/** 64 hex characters: 256 bits, and nothing that needs escaping anywhere. */
function newPassword() {
  return randomBytes(32).toString('hex');
}

/** `ALTER ROLE` with a precomputed verifier. The role name is checked, so nothing unescaped is ever spliced in. */
function setPasswordSql(role, password) {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`Unexpected role name "${role}"`);
  return `ALTER ROLE "${role}" PASSWORD '${scramVerifier(password)}'`;
}

module.exports = { loginsOf, roleInUrl, urlFor, newPassword, setPasswordSql };
