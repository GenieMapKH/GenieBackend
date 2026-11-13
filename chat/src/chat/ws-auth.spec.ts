import { fakeAuthKeys, FakeAuthKeys } from '@tilomnov/shared/testing';
import * as jwt from 'jsonwebtoken';
import { authenticateSocket, verifyAccessToken } from './ws-auth';

describe('verifyAccessToken', () => {
  let keys: FakeAuthKeys;
  const sign = (
    claims: object,
    expiresIn: jwt.SignOptions['expiresIn'] = '5m',
  ) => keys.sign(claims, { expiresIn });

  beforeAll(() => (keys = fakeAuthKeys()));
  afterAll(() => keys.restore());

  it('returns the user and the session an access token was issued to', async () => {
    await expect(
      verifyAccessToken(sign({ typ: 'access', sid: 'session-1' })),
    ).resolves.toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
      expiresAt: expect.any(Number),
    });
    // Legacy access tokens must renew into a durable, identifiable session.
    await expect(
      verifyAccessToken(sign({ typ: 'access', sid: undefined })),
    ).rejects.toThrow('Sign in again');
  });

  it('refuses a refresh token, which lives 30 days and may have been revoked', async () => {
    await expect(
      verifyAccessToken(sign({ typ: 'refresh', jti: 'token-1' }, '30d')),
    ).rejects.toThrow('Not a token of type');
    await expect(verifyAccessToken(sign({}))).rejects.toThrow(
      'Not a token of type',
    );
    await expect(
      verifyAccessToken(sign({ typ: 'password-proof' })),
    ).rejects.toThrow('Not a token of type');
  });

  it('refuses an expired token and one signed with another key', async () => {
    await expect(
      verifyAccessToken(sign({ typ: 'access' }, -10)),
    ).rejects.toThrow();
    const pem = keys.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString();
    await expect(
      verifyAccessToken(
        jwt.sign({ sub: 'user-1', typ: 'access' }, pem, {
          algorithm: 'HS256',
          keyid: keys.kid,
        }),
      ),
    ).rejects.toThrow();
  });

  describe('authenticateSocket', () => {
    const socketWith = (token?: string) =>
      ({
        handshake: { headers: {}, auth: { token } },
        data: {} as Record<string, unknown>,
        once: jest.fn(),
        disconnect: jest.fn(),
      }) as never;
    const revoked = (...signedOut: string[]) =>
      ({ has: async (id: string) => signedOut.includes(id) }) as never;

    it('remembers who the socket belongs to', async () => {
      const socket = socketWith(sign({ typ: 'access', sid: 'phone' }));

      await authenticateSocket(socket, revoked());

      expect((socket as { data: unknown }).data).toEqual({
        userId: 'user-1',
        sessionId: 'phone',
        expiresAt: expect.any(Number),
      });
    });

    it('refuses a device that was signed out, although its token has not expired', async () => {
      const socket = socketWith(sign({ typ: 'access', sid: 'phone' }));

      await expect(
        authenticateSocket(socket, revoked('phone')),
      ).rejects.toThrow('signed out');
      await expect(
        authenticateSocket(socket, revoked('laptop')),
      ).resolves.toBeDefined();
    });

    it('refuses a socket without a token', async () => {
      await expect(
        authenticateSocket(socketWith(undefined), revoked()),
      ).rejects.toThrow('No token provided');
    });

    it('disconnects an idle receiver after durable revocation even when Redis lost the notification', async () => {
      jest.useFakeTimers();
      keys.setSessionActive(true);
      try {
        const socket = socketWith(sign({ typ: 'access', sid: 'phone' }));
        await authenticateSocket(socket, revoked());
        keys.setSessionActive(false);
        await jest.advanceTimersByTimeAsync(5100);
        expect(
          (socket as { disconnect: jest.Mock }).disconnect,
        ).toHaveBeenCalledWith(true);
      } finally {
        keys.setSessionActive(true);
        jest.useRealTimers();
      }
    });

    it('disconnects an idle socket at token expiry without leaking timers into shared socket data', async () => {
      jest.useFakeTimers();
      try {
        const socket = socketWith(sign({ typ: 'access' }, 2)) as unknown as {
          disconnect: jest.Mock;
          data: object;
        };
        await authenticateSocket(socket as never, revoked());
        expect(
          Object.values(socket.data).some(
            (value) => value !== null && typeof value === 'object',
          ),
        ).toBe(false);
        jest.advanceTimersByTime(2100);
        expect(socket.disconnect).toHaveBeenCalledWith(true);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
