'use strict';
const crypto = require('node:crypto');
const { identityKeyFor, pinVerifierFor } = require('./config');

/** Stand-ins for what the app encrypts on the phone: the server only stores them. */
function sealedText() {
  return {
    ciphertext: crypto.randomBytes(48).toString('base64'),
    nonce: crypto.randomBytes(24).toString('base64'),
  };
}

/** The backup the app uploads when a PIN is created, for this QA account. */
function backupFor(envName, role) {
  return {
    backupBlob: crypto.createHash('sha256').update(`blob:${envName}:${role}`).digest('base64'),
    backupSalt: crypto.createHash('sha256').update(`salt:${envName}:${role}`).digest('base64'),
    backupNonce: crypto.createHash('sha256').update(`nonce:${envName}:${role}`).digest('base64').slice(0, 32),
    backupVerifier: pinVerifierFor(envName, role),
    protectedBy: 'pin',
  };
}

/**
 * The chat PIN every account must have before it can send. Saved with the
 * current PIN as proof, which creates it on the first run and rewrites the
 * same backup on later ones. Not recorded. It never looks the backup up:
 * lookups are limited to 5 per 15 minutes per account.
 */
async function ensureChatPin(t, role) {
  const { accessToken: token, deviceHeaders: headers } = t.session(role);
  await t.api.request('POST', '/chat/keys', { token, headers, body: { identityPublicKey: identityKeyFor(t.env.name, role) } });
  const backup = backupFor(t.env.name, role);
  const saved = await t.api.request('POST', '/chat/backup', {
    token,
    headers,
    body: { ...backup, currentBackupVerifier: backup.backupVerifier },
  });
  t.check([200, 201].includes(saved.status), `${role}: saving the chat PIN gave ${saved.status} ${JSON.stringify(saved.body)}`);
}

module.exports = { sealedText, backupFor, ensureChatPin };
