import { generateKeyPairSync } from 'crypto';
import {
  AuthKeySet,
  KeySetUnavailableError,
  LEGACY_SIGNING_KEY_ID,
  UnknownSigningKeyError,
} from './auth-key-set';

const URL = 'http://auth/v1/auth/.well-known/jwks.json';

function jwk(kid: string, alg = 'RS256') {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { ...publicKey.export({ format: 'jwk' }), kid, alg, use: 'sig' };
}

describe('AuthKeySet', () => {
  let now: number;
  let published: object[];
  let down: boolean;
  const fetchKeys = jest.fn(() =>
    down
      ? Promise.reject(new Error('ECONNREFUSED'))
      : Promise.resolve(Response.json({ keys: published })),
  );
  const keySet = () => new AuthKeySet(URL, fetchKeys as never, () => now);

  beforeEach(() => {
    now = 1_000_000;
    published = [jwk('k1')];
    down = false;
    fetchKeys.mockClear();
  });

  it('fetches once and serves later lookups from the cache', async () => {
    const keys = keySet();
    await keys.key('k1');
    await keys.key('k1');

    expect(fetchKeys).toHaveBeenCalledTimes(1);
  });

  it('checks a token without a kid against the pre-rotation key', async () => {
    published = [jwk(LEGACY_SIGNING_KEY_ID)];

    await expect(keySet().key(undefined)).resolves.toBeDefined();
  });

  it('fetches again for an unknown kid, so a freshly rotated key works at once', async () => {
    const keys = keySet();
    await keys.key('k1');
    published = [jwk('k1'), jwk('k2')];
    now += 31_000;

    await expect(keys.key('k2')).resolves.toBeDefined();
    expect(fetchKeys).toHaveBeenCalledTimes(2);
  });

  it('does not let a stream of made-up kids hammer the auth service', async () => {
    const keys = keySet();
    await keys.key('k1');

    for (let i = 0; i < 5; i++) {
      await expect(keys.key(`fake-${i}`)).rejects.toThrow(
        UnknownSigningKeyError,
      );
    }
    expect(fetchKeys).toHaveBeenCalledTimes(1);
  });

  it('drops a key 10 minutes after the auth service stops publishing it', async () => {
    const keys = keySet();
    await keys.key('k1');
    published = [jwk('k2')];
    now += 10 * 60_000 + 1;

    await expect(keys.key('k1')).rejects.toThrow(UnknownSigningKeyError);
  });

  it('keeps the cached keys while the auth service is down', async () => {
    const keys = keySet();
    await keys.key('k1');
    down = true;
    now += 60 * 60_000;

    await expect(keys.key('k1')).resolves.toBeDefined();
  });

  it('says the keys are unavailable when none were ever loaded', async () => {
    down = true;

    await expect(keySet().key('k1')).rejects.toThrow(KeySetUnavailableError);
  });

  it('ignores keys that are not RS256 signing keys', async () => {
    published = [jwk('hs', 'HS256'), jwk('k1')];
    const keys = keySet();

    await expect(keys.key('hs')).rejects.toThrow(UnknownSigningKeyError);
    expect(keys.size).toBe(1);
  });
});
