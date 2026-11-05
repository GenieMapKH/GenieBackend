// Prints fresh random secrets as .env lines. Nothing is written to disk:
// copy the output into your .env / hosting variables.
// Usage: npm run keys:generate
//
// Token signing keys are not generated here: the authentication service
// creates and rotates them itself (docs/SECRET_ROTATION.md).
const { randomBytes } = require('crypto');

const secret = () => randomBytes(32).toString('base64');

console.log(`JWT_KEY_ENCRYPTION_KEY=${secret()}`);
console.log(`INTERNAL_SERVICE_SECRET=${secret()}`);
