import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const FORMAT_VERSION = 'v1';

/**
 * Encrypts the private signing keys before they are stored, with
 * `JWT_KEY_ENCRYPTION_KEY` (32 random bytes, base64). A database dump or
 * backup alone then cannot sign tokens. The key id is bound to the ciphertext,
 * so a stored key cannot be moved to another row.
 */
export class SigningKeyCipher {
  private readonly key: Buffer;

  constructor(base64Key: string | undefined) {
    const key = Buffer.from(base64Key ?? '', 'base64');
    if (key.length !== 32) {
      throw new Error(
        'JWT_KEY_ENCRYPTION_KEY must be 32 random bytes, base64: ' +
          `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
      );
    }
    this.key = key;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): SigningKeyCipher {
    return new SigningKeyCipher(env.JWT_KEY_ENCRYPTION_KEY);
  }

  encrypt(privateKeyPem: string, kid: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(kid));
    const data = Buffer.concat([
      cipher.update(privateKeyPem, 'utf8'),
      cipher.final(),
    ]);
    return [FORMAT_VERSION, iv, cipher.getAuthTag(), data]
      .map((part) =>
        typeof part === 'string' ? part : part.toString('base64url'),
      )
      .join('.');
  }

  /** Throws when the value was encrypted under another key, or altered. */
  decrypt(stored: string, kid: string): string {
    const [version, iv, tag, data] = stored.split('.');
    if (version !== FORMAT_VERSION || !iv || !tag || !data) {
      throw new Error('Unrecognised encrypted key format');
    }
    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAAD(Buffer.from(kid));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
