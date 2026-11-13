import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { clientContextFrom } from './client-context';
import { EstablishedDeviceService } from './established-device.service';
import { isPublicAddress } from './ip-location.provider';
import { hashRefreshToken } from './refresh-token-hash';
import { SessionRevocationService } from './session-revocation.service';
import { SessionService } from './session.service';
import { continueOrStartSession } from './token-issuer.service';

const CLIENT = {
  deviceName: 'Pixel 8',
  platform: 'Android 15',
  ipAddress: '203.0.113.7',
};

/** A stored token of session `s1`, as the repository returns it. */
const storedToken = (overrides: Record<string, unknown> = {}) => ({
  id: 't1',
  user_id: 'u1',
  token_hash: 'x',
  revoked: false,
  created_at: '2026-03-02T08:00:00.000Z',
  session_id: 's1',
  session_started_at: '2026-03-01T08:00:00.000Z',
  device_name: 'Pixel 8',
  platform: 'Android 15',
  ip_address: '203.0.113.7',
  location: 'Phnom Penh, Cambodia',
  ...overrides,
});

describe('SessionService', () => {
  const REFRESH_TOKEN = 'signed.refresh.token';
  const jwt = { verifyRefreshToken: jest.fn() };
  const refreshTokens = {
    findById: jest.fn(),
    withUserLock: jest.fn(),
    revokeIfActive: jest.fn(),
    revokeById: jest.fn(),
    revokeAllForUser: jest.fn(),
    revokeSession: jest.fn(),
    hasActiveToken: jest.fn(),
    listSessionTokens: jest.fn(),
  };
  const issuer = { issue: jest.fn() };
  const users = { findById: jest.fn() };
  /** The sessions whose access tokens were cut off. */
  const cutOff = { add: jest.fn() };
  let service: SessionService;

  beforeEach(() => {
    jest.resetAllMocks();
    refreshTokens.withUserLock.mockImplementation((_id, work) =>
      work(undefined),
    );
    refreshTokens.revokeAllForUser.mockResolvedValue([]);
    service = new SessionService(
      jwt as never,
      refreshTokens as never,
      issuer as never,
      users as never,
      new SessionRevocationService(refreshTokens as never, cutOff as never),
      new EstablishedDeviceService(refreshTokens as never),
    );
    jwt.verifyRefreshToken.mockReturnValue({ sub: 'u1', jti: 't1' });
  });

  describe('refresh', () => {
    it('never renews a banned account even when its stored token was previously active', async () => {
      refreshTokens.findById.mockResolvedValue(
        storedToken({ token_hash: hashRefreshToken(REFRESH_TOKEN) }),
      );
      refreshTokens.revokeIfActive.mockResolvedValue(true);
      users.findById.mockResolvedValue({
        id: 'u1',
        role: 'user',
        banned_at: '2026-11-09T00:00:00Z',
      });
      await expect(service.refresh(REFRESH_TOKEN, CLIENT)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(issuer.issue).not.toHaveBeenCalled();
    });
    it('rotates: revokes the used token and issues a new pair in the same session', async () => {
      const used = storedToken({
        token_hash: bcrypt.hashSync(REFRESH_TOKEN, 4),
      });
      refreshTokens.findById.mockResolvedValue(used);
      refreshTokens.revokeIfActive.mockResolvedValue(true);
      users.findById.mockResolvedValue({ id: 'u1', role: 'agent' });
      issuer.issue.mockResolvedValue({
        accessToken: 'new-a',
        refreshToken: 'new-r',
      });

      const result = await service.refresh(REFRESH_TOKEN, CLIENT);

      expect(refreshTokens.revokeIfActive).toHaveBeenCalledWith(
        't1',
        undefined,
      );
      expect(issuer.issue).toHaveBeenCalledWith(
        'u1',
        'agent',
        CLIENT,
        used,
        false,
        undefined,
      );
      expect(result).toEqual({ accessToken: 'new-a', refreshToken: 'new-r' });
    });

    it('refuses password-only admin refresh and preserves email proof on verified refresh', async () => {
      const used = storedToken({ token_hash: hashRefreshToken(REFRESH_TOKEN) });
      refreshTokens.findById.mockResolvedValue(used);
      refreshTokens.revokeIfActive.mockResolvedValue(true);
      users.findById.mockResolvedValue({ id: 'u1', role: 'admin' });
      issuer.issue.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
      await expect(service.refresh(REFRESH_TOKEN, CLIENT)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(issuer.issue).not.toHaveBeenCalled();
      jwt.verifyRefreshToken.mockReturnValue({
        sub: 'u1',
        jti: 't1',
        adminMfa: true,
      });
      await service.refresh(REFRESH_TOKEN, CLIENT);
      expect(issuer.issue).toHaveBeenCalledWith(
        'u1',
        'admin',
        CLIENT,
        used,
        true,
        undefined,
      );
    });

    it('accepts a token stored with the current hash, and refuses another one', async () => {
      refreshTokens.findById.mockResolvedValue(
        storedToken({ token_hash: hashRefreshToken(REFRESH_TOKEN) }),
      );
      refreshTokens.revokeIfActive.mockResolvedValue(true);
      users.findById.mockResolvedValue({ id: 'u1', role: 'agent' });
      issuer.issue.mockResolvedValue({
        accessToken: 'new-a',
        refreshToken: 'new-r',
      });

      await expect(service.refresh(REFRESH_TOKEN, CLIENT)).resolves.toEqual({
        accessToken: 'new-a',
        refreshToken: 'new-r',
      });

      refreshTokens.findById.mockResolvedValue(
        storedToken({ token_hash: hashRefreshToken('some-other-token') }),
      );
      await expect(service.refresh(REFRESH_TOKEN, CLIENT)).rejects.toThrow(
        'Invalid refresh token signature',
      );
    });

    it('treats a replayed token as theft when its session moved on, and revokes every session', async () => {
      refreshTokens.findById.mockResolvedValue(storedToken({ revoked: true }));
      refreshTokens.hasActiveToken.mockResolvedValue(true);

      await expect(service.refresh(REFRESH_TOKEN, CLIENT)).rejects.toThrow(
        'Token theft detected',
      );
      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith(
        'u1',
        undefined,
      );
      expect(issuer.issue).not.toHaveBeenCalled();
    });

    it('only refuses a device that was signed out: the other devices stay signed in', async () => {
      refreshTokens.findById.mockResolvedValue(storedToken({ revoked: true }));
      refreshTokens.hasActiveToken.mockResolvedValue(false);

      await expect(service.refresh(REFRESH_TOKEN, CLIENT)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(refreshTokens.hasActiveToken).toHaveBeenCalledWith('s1');
      expect(refreshTokens.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('still treats a revoked token from before sessions existed as theft', async () => {
      refreshTokens.findById.mockResolvedValue(
        storedToken({ revoked: true, session_id: null }),
      );

      await expect(service.refresh(REFRESH_TOKEN, CLIENT)).rejects.toThrow(
        'Token theft detected',
      );
      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith(
        'u1',
        undefined,
      );
    });

    it('revokes everything when two requests race to use the same token', async () => {
      refreshTokens.findById.mockResolvedValue(
        storedToken({ token_hash: bcrypt.hashSync(REFRESH_TOKEN, 4) }),
      );
      refreshTokens.revokeIfActive.mockResolvedValue(false);

      await expect(service.refresh(REFRESH_TOKEN, CLIENT)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith(
        'u1',
        undefined,
      );
    });

    it('rejects a token that fails signature verification', async () => {
      jwt.verifyRefreshToken.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.refresh('garbage', CLIENT)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(refreshTokens.findById).not.toHaveBeenCalled();
    });

    it('rejects a token whose database row is gone', async () => {
      refreshTokens.findById.mockResolvedValue(null);

      await expect(service.refresh(REFRESH_TOKEN, CLIENT)).rejects.toThrow(
        'Refresh token not found',
      );
    });
  });

  describe('logout', () => {
    it('revokes the token even when it has already expired', async () => {
      await service.logout(REFRESH_TOKEN);

      expect(jwt.verifyRefreshToken).toHaveBeenCalledWith(REFRESH_TOKEN, {
        ignoreExpiration: true,
      });
      expect(refreshTokens.revokeById).toHaveBeenCalledWith('t1');
    });

    it('cuts the device off at once, not when its access token expires', async () => {
      refreshTokens.revokeById.mockResolvedValue('s1');

      await service.logout(REFRESH_TOKEN);

      expect(cutOff.add).toHaveBeenCalledWith(['s1']);
    });
  });

  describe('logged-in devices', () => {
    const NOW = new Date('2026-03-10T12:00:00.000Z');
    /** This device signed in days ago; the other one an hour ago. */
    const established = storedToken();
    const newcomer = storedToken({
      id: 't2',
      session_id: 's2',
      session_started_at: '2026-03-10T11:00:00.000Z',
    });
    const fromEstablished = { userId: 'u1', sessionId: 's1' };
    const fromNewcomer = { userId: 'u1', sessionId: 's2' };

    beforeEach(() => {
      jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
      refreshTokens.listSessionTokens.mockResolvedValue([
        established,
        newcomer,
      ]);
    });

    afterEach(() => jest.useRealTimers());

    it('lists each session with its device, place and times, marking the one asking', async () => {
      refreshTokens.listSessionTokens.mockResolvedValue([
        storedToken(),
        storedToken({
          id: 't2',
          session_id: 's2',
          device_name: null,
          location: null,
          session_started_at: null,
        }),
      ]);

      const { sessions } = await service.listSessions(fromEstablished);

      expect(sessions).toEqual([
        {
          id: 's1',
          deviceName: 'Pixel 8',
          platform: 'Android 15',
          ipAddress: '203.0.113.7',
          location: 'Phnom Penh, Cambodia',
          signedInAt: '2026-03-01T08:00:00.000Z',
          lastUsedAt: '2026-03-02T08:00:00.000Z',
          current: true,
        },
        expect.objectContaining({
          id: 's2',
          deviceName: null,
          signedInAt: '2026-03-02T08:00:00.000Z',
          current: false,
        }),
      ]);
    });

    it('signs another device out at once', async () => {
      refreshTokens.revokeSession.mockResolvedValue(true);

      await service.revokeSession(fromEstablished, 's2');

      expect(refreshTokens.revokeSession).toHaveBeenCalledWith('u1', 's2');
      expect(cutOff.add).toHaveBeenCalledWith(['s2']);
    });

    it('cannot sign out a session of another account', async () => {
      refreshTokens.revokeSession.mockResolvedValue(false);

      await expect(
        service.revokeSession(fromEstablished, 'someone-elses-session'),
      ).rejects.toThrow(NotFoundException);
      expect(cutOff.add).not.toHaveBeenCalled();
    });

    it('logoutAll ends every session of the user, at once', async () => {
      refreshTokens.revokeAllForUser.mockResolvedValue(['s1', 's2']);

      await service.logoutAll(fromEstablished);

      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith(
        'u1',
        undefined,
      );
      expect(cutOff.add).toHaveBeenCalledWith(['s1', 's2']);
    });

    describe('a device that signed in less than a day ago', () => {
      it('cannot sign the other devices out: a thief with the password must not lock the owner out', async () => {
        await expect(service.revokeSession(fromNewcomer, 's1')).rejects.toThrow(
          ForbiddenException,
        );
        await expect(service.logoutAll(fromNewcomer)).rejects.toThrow(
          ForbiddenException,
        );

        expect(refreshTokens.revokeSession).not.toHaveBeenCalled();
        expect(refreshTokens.revokeAllForUser).not.toHaveBeenCalled();
      });

      it('is told from when it may', async () => {
        await expect(service.logoutAll(fromNewcomer)).rejects.toMatchObject({
          // The code is how the app tells this refusal from a wrong password.
          response: {
            code: 'DEVICE_TOO_NEW',
            canSignOutOthersFrom: '2026-03-11T11:00:00.000Z',
          },
        });
        expect(await service.listSessions(fromNewcomer)).toMatchObject({
          canSignOutOthers: false,
          canSignOutOthersFrom: '2026-03-11T11:00:00.000Z',
        });
      });

      it('may still sign itself out', async () => {
        refreshTokens.revokeSession.mockResolvedValue(true);

        await expect(
          service.revokeSession(fromNewcomer, 's2'),
        ).resolves.toBeDefined();
      });

      it('may once the day has passed', async () => {
        jest.setSystemTime(new Date('2026-03-11T11:00:01.000Z'));
        refreshTokens.revokeSession.mockResolvedValue(true);

        await expect(
          service.revokeSession(fromNewcomer, 's1'),
        ).resolves.toBeDefined();
      });
    });

    it('an established device may sign the others out, so the owner can remove a newcomer', async () => {
      expect(await service.listSessions(fromEstablished)).toMatchObject({
        canSignOutOthers: true,
      });
    });

    it('a token without a known session can only look', async () => {
      const unknown = { userId: 'u1', sessionId: null };

      expect(await service.listSessions(unknown)).toMatchObject({
        canSignOutOthers: false,
        canSignOutOthersFrom: null,
      });
      await expect(service.logoutAll(unknown)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});

describe('continueOrStartSession', () => {
  it('starts a new session at sign-in', () => {
    const session = continueOrStartSession(CLIENT);

    expect(session).toMatchObject({ ...CLIENT, location: null });
    expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(continueOrStartSession(CLIENT).id).not.toBe(session.id);
  });

  it('keeps the session, its start and its place across a refresh from the same address', () => {
    const session = continueOrStartSession(
      { deviceName: null, platform: null, ipAddress: '203.0.113.7' },
      storedToken(),
    );

    expect(session).toEqual({
      id: 's1',
      startedAt: '2026-03-01T08:00:00.000Z',
      deviceName: 'Pixel 8',
      platform: 'Android 15',
      ipAddress: '203.0.113.7',
      location: 'Phnom Penh, Cambodia',
    });
  });

  it('forgets the place when the device moved to another address', () => {
    const session = continueOrStartSession(
      { ...CLIENT, ipAddress: '198.51.100.9' },
      storedToken(),
    );

    expect(session).toMatchObject({
      id: 's1',
      ipAddress: '198.51.100.9',
      location: null,
    });
  });

  it('turns a token from before sessions existed into a session', () => {
    const session = continueOrStartSession(
      CLIENT,
      storedToken({ session_id: null, session_started_at: null }),
    );

    expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.startedAt).toBe('2026-03-02T08:00:00.000Z');
  });
});

describe('clientContextFrom', () => {
  it('reads the device from the app and the address from the gateway', () => {
    expect(
      clientContextFrom({
        'x-device-name': 'Sokha%E2%80%99s%20iPhone',
        'x-device-platform': 'iOS 19.1',
        'x-client-ip': '203.0.113.7',
      }),
    ).toEqual({
      deviceName: 'Sokha’s iPhone',
      platform: 'iOS 19.1',
      ipAddress: '203.0.113.7',
    });
  });

  it('keeps only a short piece of printable text', () => {
    const context = clientContextFrom({
      'x-device-name': `Pixel\r\n8${'x'.repeat(500)}`,
      'x-device-platform': '   ',
    });

    expect(context.deviceName).toHaveLength(100);
    expect(context.deviceName).toMatch(/^Pixel8x+$/);
    expect(context.platform).toBeNull();
    expect(context.ipAddress).toBeNull();
  });
});

describe('isPublicAddress', () => {
  it.each(['8.8.8.8', '203.0.113.7', '2001:4860:4860::8888', '::ffff:8.8.8.8'])(
    'looks up %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it.each([
    '192.168.1.20',
    '10.0.0.5',
    '172.17.0.1',
    '127.0.0.1',
    '::1',
    '::ffff:192.168.1.20',
    'fe80::1',
    'nonsense',
  ])('does not send %s to a lookup service', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});
