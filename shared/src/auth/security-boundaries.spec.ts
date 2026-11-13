import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { fakeAuthKeys, FakeAuthKeys } from '../testing/fake-auth-keys';
import { CurrentUserId } from './current-user-id.decorator';
import { AdminGuard } from './admin.guard';
import { JwtStrategy } from './jwt.strategy';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

class Endpoint {
  read(@CurrentUserId() _id: string): void {}
}
const argument = Object.values(
  Reflect.getMetadata(ROUTE_ARGS_METADATA, Endpoint, 'read'),
)[0] as { factory: (data: unknown, context: unknown) => Promise<string> };
const context = (headers: object) => ({
  switchToHttp: () => ({ getRequest: () => ({ headers }) }),
});

describe('durable identity boundaries', () => {
  let keys: FakeAuthKeys;
  const claims = {
    typ: 'access',
    sid: 'device-1',
    role: 'admin',
    adminMfa: true,
  };
  beforeAll(() => {
    keys = fakeAuthKeys();
  });
  afterAll(() => keys.restore());
  beforeEach(() => {
    keys.setSessionActive(true);
    keys.setDown(false);
  });

  it('does not accept gateway-looking identity headers without the signed access token', async () => {
    await expect(
      argument.factory(
        null,
        context({ 'x-user-id': 'victim', 'x-user-role': 'admin' }),
      ),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      argument.factory(
        null,
        context({
          authorization: `Bearer ${keys.sign({ ...claims, role: 'user' })}`,
          'x-user-id': 'victim',
        }),
      ),
    ).resolves.toBe('user-1');
  });

  it('never restores admin access after a healthy Redis loses its marker', async () => {
    const redis = { client: { exists: jest.fn().mockResolvedValue(0) } };
    const guard = new AdminGuard(
      { user: { findFirst: async () => ({ role: 'admin' }) } } as never,
      redis as never,
    );
    const token = keys.sign(claims);
    await expect(
      guard.canActivate(context({ authorization: `Bearer ${token}` }) as never),
    ).resolves.toBe(true);
    keys.setSessionActive(false);
    await expect(
      guard.canActivate(context({ authorization: `Bearer ${token}` }) as never),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      argument.factory(null, context({ authorization: `Bearer ${token}` })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('degrades revoked optional authentication to a guest, not an authenticated reader', async () => {
    const strategy = new JwtStrategy();
    const request = {
      headers: { authorization: `Bearer ${keys.sign(claims)}` },
    };
    await expect(
      strategy.validate(request, { sub: 'user-1', ...claims }),
    ).resolves.toMatchObject({ userId: 'user-1' });
    keys.setSessionActive(false);
    const error = await strategy
      .validate(request, { sub: 'user-1', ...claims })
      .catch((value) => value);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(
      new OptionalJwtAuthGuard().handleRequest(error, false, undefined),
    ).toBeNull();
  });

  it('reports a verification outage as 503 instead of granting access or causing client logout', async () => {
    const token = keys.sign(claims);
    await argument.factory(null, context({ authorization: `Bearer ${token}` }));
    keys.setDown(true);
    await expect(
      argument.factory(null, context({ authorization: `Bearer ${token}` })),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
