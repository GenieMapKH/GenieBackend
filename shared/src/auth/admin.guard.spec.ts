import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { fakeAuthKeys, FakeAuthKeys } from '../testing/fake-auth-keys';

describe('AdminGuard', () => {
  const userTable = { findFirst: jest.fn() };
  const redis = { client: { exists: jest.fn() } };
  const guard = new AdminGuard({ user: userTable } as never, redis as never);
  let keys: FakeAuthKeys;
  beforeAll(() => {
    keys = fakeAuthKeys();
  });
  afterAll(() => keys.restore());
  beforeEach(() => {
    userTable.findFirst.mockReset().mockResolvedValue({ role: 'admin' });
    redis.client.exists.mockReset().mockResolvedValue(0);
  });
  const token = (claims: object = {}, options = {}) =>
    keys.sign(
      {
        typ: 'access',
        role: 'admin',
        adminMfa: true,
        sid: 'session-1',
        ...claims,
      },
      options,
    );
  const request = (
    authorization?: string,
    extra: Record<string, string> = {},
  ) => {
    const caller = {
      headers: {
        ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
        ...extra,
      },
    };
    return {
      caller,
      context: { switchToHttp: () => ({ getRequest: () => caller }) } as never,
    };
  };

  it('verifies the signature, current account and session, and replaces forged identity headers', async () => {
    const { caller, context } = request(token(), {
      'x-user-id': 'someone-else',
      'x-user-role': 'user',
      'x-admin-mfa': 'false',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(userTable.findFirst).toHaveBeenCalledWith({
      where: { id: 'user-1', deactivatedAt: null },
      select: { role: true },
    });
    expect(redis.client.exists).toHaveBeenCalledWith(
      'sessions:revoked:session-1',
    );
    expect(caller.headers).toMatchObject({
      'x-user-id': 'user-1',
      'x-user-role': 'admin',
      'x-admin-mfa': 'true',
    });
  });

  it('refuses forged admin headers without a signed token', async () => {
    await expect(
      guard.canActivate(
        request(undefined, {
          'x-user-id': 'owner',
          'x-user-role': 'admin',
          'x-admin-mfa': 'true',
        }).context,
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(userTable.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    { role: 'user' },
    { role: 'admin', adminMfa: false },
    { adminMfa: 'true' },
  ])('refuses unprivileged or unverified signed claims: %p', async (claims) => {
    await expect(
      guard.canActivate(
        request(token(claims), {
          'x-user-role': 'admin',
          'x-admin-mfa': 'true',
        }).context,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(userTable.findFirst).not.toHaveBeenCalled();
  });

  it.each(['refresh', 'internal', 'password-proof'])(
    'rejects a signed %s token',
    async (typ) => {
      await expect(
        guard.canActivate(request(token({ typ })).context),
      ).rejects.toThrow(UnauthorizedException);
    },
  );

  it('rejects expired, tampered and malformed tokens', async () => {
    const valid = token();
    const [header, , signature] = valid.split('.');
    const forged = `${header}.${Buffer.from(JSON.stringify({ sub: 'owner', typ: 'access', role: 'admin', adminMfa: true })).toString('base64url')}.${signature}`;
    for (const invalid of [token({}, { expiresIn: -1 }), forged, 'garbage']) {
      await expect(guard.canActivate(request(invalid).context)).rejects.toThrow(
        UnauthorizedException,
      );
    }
  });

  it('requires a session identifier for administrator access', async () => {
    await expect(
      guard.canActivate(request(token({ sid: undefined })).context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it.each([null, { role: 'user' }])(
    'refuses a deactivated, missing or demoted account: %p',
    async (account) => {
      userTable.findFirst.mockResolvedValue(account);
      await expect(guard.canActivate(request(token()).context)).rejects.toThrow(
        ForbiddenException,
      );
    },
  );

  it('rejects a signed-out session and fails closed when revocation cannot be checked', async () => {
    redis.client.exists.mockResolvedValue(1);
    await expect(guard.canActivate(request(token()).context)).rejects.toThrow(
      UnauthorizedException,
    );
    redis.client.exists.mockRejectedValue(new Error('Redis unavailable'));
    await expect(guard.canActivate(request(token()).context)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('reports a signing-key outage as unavailable instead of granting access', async () => {
    keys.restore();
    keys = fakeAuthKeys();
    keys.setDown(true);
    await expect(guard.canActivate(request(token()).context)).rejects.toThrow(
      ServiceUnavailableException,
    );
    keys.restore();
    keys = fakeAuthKeys();
  });
});
