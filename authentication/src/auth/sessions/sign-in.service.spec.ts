import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from '../jwt.strategy';
import { SigningKeyStore } from '../signing-keys/signing-key.store';
import { signInAlertEmailHtml } from '../mail/sign-in-alert-email.template';
import { RevokedSessionStore } from './revoked-session.store';
import { SignInService } from './sign-in.service';

// firebase-admin (reached through AccountService) pulls in ESM-only packages Jest cannot load.
jest.mock('../../firebase/firebase.service', () => ({
  FirebaseService: class {},
}));

const CLIENT = {
  deviceName: 'Pixel 8',
  platform: 'Android 15',
  ipAddress: '203.0.113.7',
};

describe('SignInService', () => {
  const account = { reactivate: jest.fn() };
  const tokens = { issue: jest.fn() };
  const refreshTokens = { listSessionTokens: jest.fn() };
  const mail = { deliver: jest.fn() };
  const notifications = { signIn: jest.fn() };
  const user = { id: 'u1', role: 'user', email: 'owner@example.com' };
  let service: SignInService;

  beforeEach(() => {
    jest.resetAllMocks();
    refreshTokens.listSessionTokens.mockResolvedValue([]);
    tokens.issue.mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r',
      sessionId: 's-new',
    });
    mail.deliver.mockResolvedValue(true);
    service = new SignInService(
      account as never,
      tokens as never,
      refreshTokens as never,
      mail as never,
      notifications as never,
    );
  });

  it('brings a deactivated account back and starts a session', async () => {
    await expect(service.complete(user as never, CLIENT)).resolves.toEqual({
      accessToken: 'a',
      refreshToken: 'r',
    });

    expect(account.reactivate).toHaveBeenCalledWith(user);
    expect(tokens.issue).toHaveBeenCalledWith(
      'u1',
      'user',
      CLIENT,
      undefined,
      false,
    );
  });

  it('requires email proof to start an admin session', async () => {
    await expect(
      service.complete({ ...user, role: 'admin' } as never, CLIENT),
    ).rejects.toThrow(UnauthorizedException);
    expect(tokens.issue).not.toHaveBeenCalled();
    await service.complete({ ...user, role: 'admin' } as never, CLIENT, {
      adminEmailVerified: true,
    });
    expect(tokens.issue).toHaveBeenCalledWith(
      'u1',
      'admin',
      CLIENT,
      undefined,
      true,
    );
  });

  it('tells the owner when the account was already in use on another device', async () => {
    refreshTokens.listSessionTokens.mockResolvedValue([
      { session_id: 'other-device' },
    ]);

    await service.complete(user as never, CLIENT);

    const message = mail.deliver.mock.calls[0][0];
    expect(message.to).toBe('owner@example.com');
    expect(message.html).toContain('Pixel 8, Android 15');
    expect(message.html).toContain('203.0.113.7');
  });

  it("pushes the alert to the account's other devices, naming the new one", async () => {
    refreshTokens.listSessionTokens.mockResolvedValue([
      { session_id: 'other-device' },
    ]);

    await service.complete(user as never, CLIENT);

    expect(notifications.signIn).toHaveBeenCalledWith({
      userId: 'u1',
      sessionId: 's-new',
      deviceName: 'Pixel 8',
      platform: 'Android 15',
    });
  });

  it('pushes the alert even for an account without email', async () => {
    refreshTokens.listSessionTokens.mockResolvedValue([
      { session_id: 'other-device' },
    ]);

    await service.complete({ ...user, email: null } as never, CLIENT);

    expect(notifications.signIn).toHaveBeenCalled();
  });

  it('sends nothing for the only device of an account: nobody else is using it', async () => {
    await service.complete(user as never, CLIENT);

    expect(mail.deliver).not.toHaveBeenCalled();
    expect(notifications.signIn).not.toHaveBeenCalled();
  });

  it('keeps the session id on the server', async () => {
    await expect(
      service.complete(user as never, CLIENT),
    ).resolves.not.toHaveProperty('sessionId');
  });

  it('signs in all the same when the account has no email, or the mail cannot be sent', async () => {
    refreshTokens.listSessionTokens.mockResolvedValue([
      { session_id: 'other-device' },
    ]);

    await expect(
      service.complete({ ...user, email: null } as never, CLIENT),
    ).resolves.toBeDefined();
    expect(mail.deliver).not.toHaveBeenCalled();

    mail.deliver.mockRejectedValue(new Error('provider down'));
    await expect(
      service.complete(user as never, CLIENT),
    ).resolves.toBeDefined();
  });
});

describe('sign-in alert email', () => {
  it('never trusts what a device says about itself as HTML', () => {
    const html = signInAlertEmailHtml({
      deviceName: '<img src=x onerror=alert(1)>',
      platform: '"Android" & more',
      ipAddress: null,
      signedInAt: new Date('2026-03-01T08:30:00Z'),
    });

    expect(html).not.toContain('<img src=x');
    expect(html).toContain(
      '&lt;img src=x onerror=alert(1)&gt;, &quot;Android&quot; &amp; more',
    );
    expect(html).toContain('2026-03-01 08:30 UTC');
  });

  it('says so when the device did not describe itself', () => {
    const html = signInAlertEmailHtml({
      deviceName: null,
      platform: null,
      ipAddress: null,
      signedInAt: new Date(),
    });

    expect(html).toContain('Unknown device');
  });
});

describe('RevokedSessionStore', () => {
  /** The two Redis commands the store uses. */
  const redis = {
    keys: new Map<string, number>(),
    published: [] as [string, string][],
    down: false,
    client: {
      set: async (key: string, _value: string, _mode: string, ttl: number) => {
        if (redis.down) throw new Error('Redis is down');
        redis.keys.set(key, ttl);
      },
      publish: async (channel: string, message: string) =>
        void redis.published.push([channel, message]),
      exists: async (key: string) => {
        if (redis.down) throw new Error('Redis is down');
        return redis.keys.has(key) ? 1 : 0;
      },
    },
  };
  const store = new RevokedSessionStore(redis as never);

  beforeEach(() => {
    redis.keys.clear();
    redis.published = [];
    redis.down = false;
  });

  it('remembers an ended session for as long as an access token of it can live, and announces it', async () => {
    await store.add(['s1', 's1', 's2']);

    expect([...redis.keys]).toEqual([
      ['sessions:revoked:s1', 15 * 60],
      ['sessions:revoked:s2', 15 * 60],
    ]);
    // The chat servers listen for this to close the device's connections.
    expect(redis.published).toEqual([
      ['sessions:revoked', 's1'],
      ['sessions:revoked', 's2'],
    ]);
    expect(await store.has('s1')).toBe(true);
    expect(await store.has('s3')).toBe(false);
  });

  it('does not turn a Redis outage into failed sign-outs or refused users', async () => {
    redis.down = true;

    await expect(store.add(['s1'])).resolves.toBeUndefined();
    expect(await store.has('s1')).toBe(false);
  });
});

describe('JwtStrategy', () => {
  const signedOut = new Set<string>();
  let strategy: JwtStrategy;

  beforeAll(() => {
    strategy = new JwtStrategy(
      { has: async (sessionId: string) => signedOut.has(sessionId) } as never,
      new SigningKeyStore(),
    );
  });

  it('says who is calling, and from which session', async () => {
    await expect(
      strategy.validate({ sub: 'u1', role: 'user', typ: 'access', sid: 's1' }),
    ).resolves.toEqual({
      userId: 'u1',
      role: 'user',
      sessionId: 's1',
    });
  });

  it('refuses a device that was signed out, so it cannot list or sign out the others', async () => {
    signedOut.add('s1');

    await expect(
      strategy.validate({ sub: 'u1', role: 'user', typ: 'access', sid: 's1' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it.each(['refresh', 'password-proof', 'internal', undefined])(
    'refuses a token of type %p',
    async (typ) => {
      await expect(
        strategy.validate({ sub: 'u1', role: 'user', typ }),
      ).rejects.toThrow(UnauthorizedException);
    },
  );
});
