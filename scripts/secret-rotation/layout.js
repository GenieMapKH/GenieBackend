// Where each secret lives in Infisical (docs/SECRET_ROTATION.md).
//
//   /<service>       synced to that Railway service: DATABASE_URL and shared-secret copies
//   /authentication  also JWT_KEY_ENCRYPTION_KEY
//   /                canonical shared-secret values, delivered through service-folder syncs:
//                    INTERNAL_SERVICE_SECRET and INTERNAL_SERVICE_SECRET_PREVIOUS
//   /rotation        NOT synced: each login's password, and when things rotated

const SERVICES = ['authentication', 'user', 'property', 'chat', 'payment', 'notification'];

const ROTATION_PATH = '/rotation';
const SHARED_PATH = '/';

const key = (text) => text.toUpperCase().replace(/[^A-Z0-9]/g, '_');

module.exports = {
  SERVICES,
  ROTATION_PATH,
  SHARED_PATH,
  servicePath: (service) => `/${service}`,
  passwordKey: (role) => `${key(role)}_PASSWORD`,
  /** Written before a password changes, so a run that stops halfway can still log in. */
  pendingKey: (role) => `${key(role)}_PASSWORD_PENDING`,
  rotatedAtKey: (name) => `${key(name)}_ROTATED_AT`,
};
