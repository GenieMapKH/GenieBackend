import { UnauthorizedException } from '@nestjs/common';
import { fakeAuthKeys, FakeAuthKeys } from '@tilomnov/shared/testing';
import * as jwt from 'jsonwebtoken';
import { InternalCallGuard } from './internal-call.guard';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

describe('InternalCallGuard', () => {
  let keys: FakeAuthKeys;
  const sign = (
    typ: string,
    sub = ALICE,
    expiresIn: jwt.SignOptions['expiresIn'] = '5m',
  ) => keys.sign({ sub, typ }, { expiresIn });
  const guard = new InternalCallGuard();
  const request = (authorization: string | undefined, userId = ALICE) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization }, params: { userId } }),
      }),
    }) as never;

  beforeAll(() => (keys = fakeAuthKeys()));
  afterAll(() => keys.restore());

  it('lets the authentication service act on the account its token names', async () => {
    await expect(
      guard.canActivate(request(`Bearer ${sign('internal')}`)),
    ).resolves.toBe(true);
  });

  it.each([
    ['no token', () => undefined],
    ['a token for another account', () => `Bearer ${sign('internal', BOB)}`],
    // A signed-in user must never be able to erase files, their own included, this way.
    ["a user's access token", () => `Bearer ${sign('access')}`],
    ['an expired token', () => `Bearer ${sign('internal', ALICE, -10)}`],
  ])('refuses %s', async (_case, authorization) => {
    await expect(guard.canActivate(request(authorization()))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
