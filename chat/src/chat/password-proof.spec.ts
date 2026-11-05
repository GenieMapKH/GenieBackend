import { ForbiddenException } from '@nestjs/common';
import { fakeAuthKeys, FakeAuthKeys } from '@tilomnov/shared/testing';
import * as jwt from 'jsonwebtoken';
import { requirePasswordProof } from './password-proof';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

describe('requirePasswordProof', () => {
  let keys: FakeAuthKeys;
  const sign = (
    typ: string,
    sub = ALICE,
    expiresIn: jwt.SignOptions['expiresIn'] = '5m',
  ) => keys.sign({ sub, typ }, { expiresIn });

  beforeAll(() => (keys = fakeAuthKeys()));
  afterAll(() => keys.restore());

  it('passes for the user who typed their password', async () => {
    await expect(
      requirePasswordProof(ALICE, sign('password-proof')),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["someone else's proof", () => sign('password-proof', BOB)],
    ['an expired proof', () => sign('password-proof', ALICE, -10)],
    // Being signed in is exactly what must not be enough.
    ['an access token', () => sign('access')],
    [
      'a forged token',
      () =>
        jwt.sign(
          { sub: ALICE, typ: 'password-proof' },
          keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
          { algorithm: 'HS256', keyid: keys.kid },
        ),
    ],
    ['nonsense', () => 'not-a-token'],
  ])('refuses %s', async (_case, token) => {
    await expect(requirePasswordProof(ALICE, token())).rejects.toThrow(
      ForbiddenException,
    );
  });
});
