import { ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

describe('AdminGuard', () => {
  const userTable = { findFirst: jest.fn() };
  const guard = new AdminGuard({ user: userTable } as never);
  const request = (
    user?: { userId: string; role?: string; adminMfa?: boolean },
    headers: Record<string, string | undefined> = {},
  ) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user, headers }) }),
    }) as never;

  beforeEach(() => userTable.findFirst.mockReset());

  it('lets an admin in', async () => {
    userTable.findFirst.mockResolvedValue({ role: 'admin' });

    await expect(
      guard.canActivate(
        request({ userId: 'a', role: 'admin', adminMfa: true }),
      ),
    ).resolves.toBe(true);
  });

  it('reads the caller the gateway wrote when no token was checked here', async () => {
    userTable.findFirst.mockResolvedValue({ role: 'admin' });

    await expect(
      guard.canActivate(
        request(undefined, {
          'x-user-id': 'a',
          'x-user-role': 'admin',
          'x-admin-mfa': 'true',
        }),
      ),
    ).resolves.toBe(true);
    expect(userTable.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a', deactivatedAt: null } }),
    );
  });

  it('keeps everyone else out', async () => {
    userTable.findFirst.mockResolvedValue({ role: 'user' });

    await expect(
      guard.canActivate(
        request({ userId: 'u', role: 'admin', adminMfa: true }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it.each([
    { 'x-user-id': 'a' },
    { 'x-user-id': 'a', 'x-user-role': 'admin' },
    { 'x-user-id': 'a', 'x-user-role': 'user', 'x-admin-mfa': 'true' },
  ])('rejects a session without verified admin claims: %j', async (headers) => {
    userTable.findFirst.mockResolvedValue({ role: 'admin' });
    await expect(
      guard.canActivate(request(undefined, headers)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('keeps out a deactivated or unknown account, and an anonymous caller', async () => {
    userTable.findFirst.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        request({ userId: 'gone', role: 'admin', adminMfa: true }),
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(request())).rejects.toThrow(
      ForbiddenException,
    );
  });
});
