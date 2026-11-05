// Rotates the secrets that are only random strings.
const { randomBytes } = require('crypto');
const { ROTATION_PATH, SHARED_PATH, rotatedAtKey, servicePath } = require('./layout');

const secret = () => randomBytes(32).toString('base64');

/**
 * INTERNAL_SERVICE_SECRET: the old value moves to _PREVIOUS first, which every
 * service also accepts, so services that redeploy at different times keep
 * trusting each other. It stays there until the next rotation replaces it.
 *
 * JWT_KEY_ENCRYPTION_KEY: on its next start the authentication service cannot
 * read its stored private keys, so it creates a new signing key. The old public
 * keys keep verifying: nobody is signed out.
 */
async function rotateSharedSecrets({ secrets, now = new Date() }) {
  const current = await secrets.get(SHARED_PATH, 'INTERNAL_SERVICE_SECRET');
  if (current) await secrets.set(SHARED_PATH, 'INTERNAL_SERVICE_SECRET_PREVIOUS', current);
  await secrets.set(SHARED_PATH, 'INTERNAL_SERVICE_SECRET', secret());

  await secrets.set(servicePath('authentication'), 'JWT_KEY_ENCRYPTION_KEY', secret());
  await secrets.set(ROTATION_PATH, rotatedAtKey('shared'), now.toISOString());
}

module.exports = { rotateSharedSecrets };
