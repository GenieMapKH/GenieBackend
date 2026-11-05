import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { fakeAuthKeys, FakeAuthKeys } from '@tilomnov/shared/testing';
import { generateKeyPairSync, KeyObject } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { AuthMiddleware } from './auth.middleware';
import { RevokedSessions } from './revoked-sessions';

describe('AuthMiddleware', () => {
  // The authentication service's JWKS, answered in-process.
  let keys: FakeAuthKeys;
  let privateKey: KeyObject;
  let publicKey: KeyObject;
  beforeAll(() => {
    keys = fakeAuthKeys();
    ({ privateKey, publicKey } = keys);
  });
  afterAll(() => keys.restore());

  /** The sessions that were signed out. */
  const signedOut = new Set<string>();
  const middleware = new AuthMiddleware({
    has: async (sessionId: string) => signedOut.has(sessionId),
  } as never);

  const run = async (headers: Record<string, string>, method = 'GET') => {
    const req = { method, headers: { ...headers } };
    const next = jest.fn();
    await middleware.use(req as never, {} as never, next);
    return { req, next };
  };
  const sign = (
    options: jwt.SignOptions = {},
    key: KeyObject = privateKey,
    claims: object = { typ: 'access' },
  ) =>
    jwt.sign({ sub: 'user-1', ...claims }, key, {
      algorithm: 'RS256',
      expiresIn: '5m',
      keyid: keys.kid,
      ...options,
    });

  beforeEach(() => signedOut.clear());

  it('writes the verified user id to x-user-id and continues', async () => {
    const { req, next } = await run({ authorization: `Bearer ${sign()}` });

    expect(req.headers['x-user-id']).toBe('user-1');
    expect(next).toHaveBeenCalled();
  });

  it('overwrites an x-user-id the client tried to supply', async () => {
    const { req } = await run({
      authorization: `Bearer ${sign()}`,
      'x-user-id': 'someone-else',
    });

    expect(req.headers['x-user-id']).toBe('user-1');
  });

  it('accepts the scheme in any letter case', async () => {
    const { req, next } = await run({ authorization: `bearer ${sign()}` });

    expect(req.headers['x-user-id']).toBe('user-1');
    expect(next).toHaveBeenCalled();
  });

  it('rejects a missing or malformed Authorization header', async () => {
    await expect(run({})).rejects.toThrow(UnauthorizedException);
    await expect(run({ authorization: 'Basic abc' })).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(run({ authorization: 'Bearer' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an expired token', async () => {
    await expect(
      run({ authorization: `Bearer ${sign({ expiresIn: -10 })}` }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token signed with a different key', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

    await expect(
      run({ authorization: `Bearer ${sign({}, other.privateKey)}` }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a refresh token, and a token that does not say what it is', async () => {
    const refresh = sign({ expiresIn: '30d' }, privateKey, {
      typ: 'refresh',
      jti: 'token-1',
    });
    const untyped = sign({}, privateKey, {});

    await expect(run({ authorization: `Bearer ${refresh}` })).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(run({ authorization: `Bearer ${untyped}` })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects the proof and internal tokens the authentication service also signs', async () => {
    for (const typ of ['password-proof', 'internal']) {
      const token = sign({}, privateKey, { typ });
      await expect(run({ authorization: `Bearer ${token}` })).rejects.toThrow(
        UnauthorizedException,
      );
    }
  });

  it('rejects an HS256 token (algorithm confusion)', async () => {
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const forged = jwt.sign({ sub: 'user-1', typ: 'access' }, pem, {
      algorithm: 'HS256',
      keyid: keys.kid,
    });

    await expect(run({ authorization: `Bearer ${forged}` })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token naming a key the authentication service does not publish', async () => {
    await expect(
      run({ authorization: `Bearer ${sign({ keyid: 'retired-key' })}` }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('answers 503, not 401, when the keys cannot be loaded, so the app does not sign out', async () => {
    keys.restore();
    const down = fakeAuthKeys();
    down.setDown(true);
    try {
      await expect(
        run({ authorization: `Bearer ${down.sign({ typ: 'access' })}` }),
      ).rejects.toThrow(ServiceUnavailableException);
    } finally {
      down.restore();
      keys = fakeAuthKeys();
      ({ privateKey, publicKey } = keys);
    }
  });

  it('accepts a token from before rotation (no kid) while the old key is published', async () => {
    keys.restore();
    const legacy = fakeAuthKeys({ legacy: true });
    try {
      const { next } = await run({
        authorization: `Bearer ${legacy.sign({ typ: 'access' })}`,
      });
      expect(next).toHaveBeenCalled();
    } finally {
      legacy.restore();
      keys = fakeAuthKeys();
      ({ privateKey, publicKey } = keys);
    }
  });

  it('lets CORS preflight requests through without a token', async () => {
    const { next } = await run({}, 'OPTIONS');

    expect(next).toHaveBeenCalled();
  });

  describe('a device that was signed out', () => {
    const token = (sid: string) => sign({}, privateKey, { typ: 'access', sid });

    it('is refused at once, although its token has not expired', async () => {
      await run({ authorization: `Bearer ${token('phone')}` });

      signedOut.add('phone');

      await expect(
        run({ authorization: `Bearer ${token('phone')}` }),
      ).rejects.toThrow('This device was signed out');
    });

    it("does not take the account's other devices with it", async () => {
      signedOut.add('phone');

      const { next } = await run({
        authorization: `Bearer ${token('laptop')}`,
      });

      expect(next).toHaveBeenCalled();
    });
  });

  it('keeps working while Redis is down: the token still expires on its own', async () => {
    const revoked = new RevokedSessions({
      client: { exists: () => Promise.reject(new Error('Redis is down')) },
    } as never);
    const next = jest.fn();
    const token = sign({}, privateKey, { typ: 'access', sid: 'phone' });

    await new AuthMiddleware(revoked).use(
      { method: 'GET', headers: { authorization: `Bearer ${token}` } } as never,
      {} as never,
      next,
    );

    expect(next).toHaveBeenCalled();
  });
});
