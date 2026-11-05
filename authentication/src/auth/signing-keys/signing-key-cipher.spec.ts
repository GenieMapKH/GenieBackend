import { randomBytes } from 'crypto';
import { SigningKeyCipher } from './signing-key-cipher';

describe('SigningKeyCipher', () => {
  const cipher = new SigningKeyCipher(randomBytes(32).toString('base64'));
  const PEM =
    '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\n';

  it('round-trips a private key and never stores it in the clear', () => {
    const stored = cipher.encrypt(PEM, 'k1');

    expect(stored).not.toContain('secret');
    expect(cipher.decrypt(stored, 'k1')).toBe(PEM);
  });

  it('refuses another encryption key, a moved row and an altered value', () => {
    const stored = cipher.encrypt(PEM, 'k1');
    const other = new SigningKeyCipher(randomBytes(32).toString('base64'));
    const [v, iv, tag, data] = stored.split('.');
    const altered = [
      v,
      iv,
      tag,
      data.slice(0, -2) + (data.endsWith('AA') ? 'BB' : 'AA'),
    ].join('.');

    expect(() => other.decrypt(stored, 'k1')).toThrow();
    expect(() => cipher.decrypt(stored, 'k2')).toThrow();
    expect(() => cipher.decrypt(altered, 'k1')).toThrow();
  });

  it('will not start without a 32-byte key', () => {
    expect(() => new SigningKeyCipher(undefined)).toThrow(
      'JWT_KEY_ENCRYPTION_KEY',
    );
    expect(() => new SigningKeyCipher('c2hvcnQ=')).toThrow(
      'JWT_KEY_ENCRYPTION_KEY',
    );
  });
});
