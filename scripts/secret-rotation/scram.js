// A Postgres SCRAM-SHA-256 password verifier, computed here so the plain
// password never reaches the server (or its statement log): Postgres stores a
// verifier given in this form as it is (ALTER ROLE ... PASSWORD 'SCRAM-SHA-256$...').
const { createHash, createHmac, pbkdf2Sync, randomBytes } = require('crypto');

const ITERATIONS = 4096; // Postgres's default scram_iterations

function hmac(key, text) {
  return createHmac('sha256', key).update(text).digest();
}

/** `SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>` (RFC 5802, as Postgres stores it). */
function scramVerifier(password, salt = randomBytes(16), iterations = ITERATIONS) {
  if (!/^[\x21-\x7e]+$/.test(password)) {
    // SASLprep is the identity for printable ASCII; anything else would need it.
    throw new Error('Rotated passwords must be printable ASCII');
  }
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const storedKey = createHash('sha256').update(hmac(salted, 'Client Key')).digest();
  const serverKey = hmac(salted, 'Server Key');
  return (
    `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}` +
    `$${storedKey.toString('base64')}:${serverKey.toString('base64')}`
  );
}

/** Whether `password` matches a stored verifier. */
function matchesVerifier(password, verifier) {
  const match = /^SCRAM-SHA-256\$(\d+):([^$]+)\$/.exec(verifier);
  if (!match) return false;
  return scramVerifier(password, Buffer.from(match[2], 'base64'), Number(match[1])) === verifier;
}

module.exports = { scramVerifier, matchesVerifier };
