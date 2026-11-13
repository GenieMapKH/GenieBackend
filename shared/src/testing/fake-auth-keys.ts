import { generateKeyPairSync, KeyObject } from 'crypto';
import * as jwt from 'jsonwebtoken';
import {
  JWKS_PATH,
  LEGACY_SIGNING_KEY_ID,
  resetAuthKeySet,
} from '../auth/auth-key-set';

export interface FakeAuthKeys {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** An RS256 token for `user-1` (override with `claims.sub`), signed like the authentication service does. */
  sign(claims: object, options?: jwt.SignOptions): string;
  /** Makes the JWKS endpoint fail, as if the authentication service were down. */
  setDown(down: boolean): void;
  /** Models the durable authentication endpoint, independently of Redis. */
  setSessionActive(active: boolean): void;
  /** Puts the real `fetch` back. */
  restore(): void;
}

/**
 * Stands in for the authentication service's JWKS endpoint: `fetch` to it
 * answers with one fresh key pair. `legacy` signs without a `kid`, like tokens
 * from before keys rotated.
 */
export function fakeAuthKeys(options: { legacy?: boolean } = {}): FakeAuthKeys {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const kid = options.legacy ? LEGACY_SIGNING_KEY_ID : 'test-key';
  const realFetch = globalThis.fetch;
  let down = false;
  let sessionActive = true;

  resetAuthKeySet();
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.endsWith('/internal/sessions/verify')) {
      if (down) return Promise.reject(new Error('connect ECONNREFUSED'));
      return Promise.resolve(
        new Response(null, { status: sessionActive ? 204 : 401 }),
      );
    }
    if (!url.endsWith(JWKS_PATH)) return realFetch(input, init);
    if (down) return Promise.reject(new Error('connect ECONNREFUSED'));
    const jwk = {
      ...publicKey.export({ format: 'jwk' }),
      kid,
      alg: 'RS256',
      use: 'sig',
    };
    return Promise.resolve(Response.json({ keys: [jwk] }));
  };

  return {
    kid,
    privateKey,
    publicKey,
    sign: (claims, signOptions = {}) =>
      jwt.sign({ sub: 'user-1', sid: 'test-session', ...claims }, privateKey, {
        algorithm: 'RS256',
        expiresIn: '5m',
        ...(options.legacy ? {} : { keyid: kid }),
        ...signOptions,
      }),
    setDown: (value) => (down = value),
    setSessionActive: (value) => (sessionActive = value),
    restore: () => {
      globalThis.fetch = realFetch;
      resetAuthKeySet();
    },
  };
}
