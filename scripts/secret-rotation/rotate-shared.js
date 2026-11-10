// Rotates the secrets that are only random strings.
const { randomBytes } = require('crypto');
const { ROTATION_PATH, SHARED_PATH, SERVICES, rotatedAtKey, servicePath } = require('./layout');

const secret = () => randomBytes(32).toString('base64');

/**
 * Stage the new key as _PREVIOUS on every running service before using it to
 * sign. Both old and new deployments can then verify each other's requests.
 *
 * JWT_KEY_ENCRYPTION_KEY: on its next start the authentication service cannot
 * read its stored private keys, so it creates a new signing key. The old public
 * keys keep verifying: nobody is signed out.
 */
async function rotateSharedSecrets({ secrets, handover, now = new Date() }) {
  // Service-folder syncs redeploy containers; a Railway shared-variable sync does not.
  const deliver = async (name, value) => {
    await secrets.set(SHARED_PATH, name, value);
    for (const service of SERVICES) await secrets.set(servicePath(service), name, value);
  };
  const current = await secrets.get(SHARED_PATH, 'INTERNAL_SERVICE_SECRET');
  if (!current || current.length < 32 || !handover) throw new Error('Shared rotation requires a valid current secret and verified Railway handover');
  await handover.waitFor(SERVICES, { INTERNAL_SERVICE_SECRET: current });
  const next = secret();
  await deliver('INTERNAL_SERVICE_SECRET_PREVIOUS', next);
  await handover.waitFor(SERVICES, { INTERNAL_SERVICE_SECRET: current, INTERNAL_SERVICE_SECRET_PREVIOUS: next });
  await deliver('INTERNAL_SERVICE_SECRET', next);
  await handover.waitFor(SERVICES, { INTERNAL_SERVICE_SECRET: next, INTERNAL_SERVICE_SECRET_PREVIOUS: next });
  await deliver('INTERNAL_SERVICE_SECRET_PREVIOUS', current);

  const encryptionKey = secret();
  await secrets.set(servicePath('authentication'), 'JWT_KEY_ENCRYPTION_KEY', encryptionKey);
  await handover.waitFor(SERVICES, { INTERNAL_SERVICE_SECRET: next, INTERNAL_SERVICE_SECRET_PREVIOUS: current });
  await handover.waitFor(['authentication'], { JWT_KEY_ENCRYPTION_KEY: encryptionKey });
  await secrets.set(ROTATION_PATH, rotatedAtKey('shared'), now.toISOString());
}

module.exports = { rotateSharedSecrets };
