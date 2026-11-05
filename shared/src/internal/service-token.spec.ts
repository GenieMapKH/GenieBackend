import { UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { serviceCallGuard } from './service-call.guard';
import { ServiceCallError, ServiceClient } from './service-client';
import { signServiceToken, verifyServiceToken } from './service-token';

const SECRET = 'a-shared-secret-of-at-least-thirty-two-characters';

function requestWith(authorization: string | undefined) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as never;
}

describe('calls between services', () => {
  const originalSecret = process.env.INTERNAL_SERVICE_SECRET;

  beforeEach(() => {
    process.env.INTERNAL_SERVICE_SECRET = SECRET;
  });

  afterAll(() => {
    if (originalSecret === undefined)
      delete process.env.INTERNAL_SERVICE_SECRET;
    else process.env.INTERNAL_SERVICE_SECRET = originalSecret;
  });

  describe('service tokens', () => {
    it('name the service that signed them', () => {
      expect(verifyServiceToken(signServiceToken('payment'))).toBe('payment');
    });

    describe('while the secret is being replaced', () => {
      const NEW_SECRET = 'the-replacement-secret-also-thirty-two-plus-chars';
      afterEach(() => delete process.env.INTERNAL_SERVICE_SECRET_PREVIOUS);

      it('accept tokens signed with the previous secret too', () => {
        const oldToken = signServiceToken('payment');
        process.env.INTERNAL_SERVICE_SECRET = NEW_SECRET;
        process.env.INTERNAL_SERVICE_SECRET_PREVIOUS = SECRET;

        expect(verifyServiceToken(oldToken)).toBe('payment');
        expect(verifyServiceToken(signServiceToken('chat'))).toBe('chat');
      });

      it('refuse the old secret once INTERNAL_SERVICE_SECRET_PREVIOUS is removed', () => {
        const oldToken = signServiceToken('payment');
        process.env.INTERNAL_SERVICE_SECRET = NEW_SECRET;

        expect(() => verifyServiceToken(oldToken)).toThrow('invalid signature');
      });

      it('do not retry an expired token with the previous secret', () => {
        process.env.INTERNAL_SERVICE_SECRET_PREVIOUS = NEW_SECRET;
        const expired = jwt.sign(
          { iss: 'payment', typ: 'service', exp: 1 },
          SECRET,
          { algorithm: 'HS256' },
        );

        expect(() => verifyServiceToken(expired)).toThrow('jwt expired');
      });
    });

    it('cannot be signed or checked without the shared secret', () => {
      delete process.env.INTERNAL_SERVICE_SECRET;

      expect(() => signServiceToken('payment')).toThrow(
        'INTERNAL_SERVICE_SECRET',
      );
    });

    it('refuses a secret too short to be safe', () => {
      process.env.INTERNAL_SERVICE_SECRET = 'short';

      expect(() => signServiceToken('payment')).toThrow('at least 32');
    });

    it.each([
      [
        'a token signed with another secret',
        () =>
          jwt.sign(
            { iss: 'payment', typ: 'service' },
            'other-secret-other-secret-other-1234',
          ),
      ],
      [
        'an expired token',
        () =>
          jwt.sign({ iss: 'payment', typ: 'service' }, SECRET, {
            expiresIn: -10,
          }),
      ],
      // A user token has no business on an internal route, whatever it is signed with.
      [
        'a token of another type',
        () =>
          jwt.sign({ iss: 'payment', typ: 'access' }, SECRET, {
            expiresIn: 60,
          }),
      ],
      ['nonsense', () => 'not-a-token'],
    ])('are refused for %s', (_case, token) => {
      expect(() => verifyServiceToken(token())).toThrow();
    });
  });

  describe('serviceCallGuard', () => {
    const guard = new (serviceCallGuard('payment'))();

    it('lets in a service on the list', () => {
      expect(
        guard.canActivate(requestWith(`Bearer ${signServiceToken('payment')}`)),
      ).toBe(true);
    });

    it.each([
      ['no token', () => undefined],
      [
        'a service that is not on the list',
        () => `Bearer ${signServiceToken('chat')}`,
      ],
      [
        'a forged token',
        () =>
          `Bearer ${jwt.sign({ iss: 'payment', typ: 'service' }, 'forged-forged-forged-forged-12345')}`,
      ],
    ])('refuses %s', (_case, authorization) => {
      expect(() => guard.canActivate(requestWith(authorization()))).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('ServiceClient', () => {
    const fetchMock = jest.fn();
    const client = new ServiceClient(
      'property',
      'http://property.test/',
      'payment',
    );

    beforeEach(() => {
      fetchMock.mockReset();
      global.fetch = fetchMock as never;
    });

    it('signs the call as its owner and sends the body as JSON', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ previousStatus: 'Draft' }), {
          status: 200,
        }),
      );

      const result = await client.call('POST', '/internal/x', {
        body: { a: 1 },
        timeoutMs: 1000,
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://property.test/internal/x');
      expect(
        verifyServiceToken(init.headers.authorization.slice('Bearer '.length)),
      ).toBe('payment');
      expect(init.body).toBe('{"a":1}');
      expect(result).toEqual({ previousStatus: 'Draft' });
    });

    it('returns nothing for an empty answer', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

      await expect(
        client.call('DELETE', '/internal/x', { timeoutMs: 1000 }),
      ).resolves.toBeUndefined();
    });

    it("keeps the other service's status and message on a refusal", async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ statusCode: 404, message: 'Property not found' }),
          { status: 404 },
        ),
      );

      await expect(
        client.call('POST', '/internal/x', { timeoutMs: 1000 }),
      ).rejects.toMatchObject({
        status: 404,
        message: 'Property not found',
      });
    });

    it('reports a service that cannot be reached with status 0', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      const failure = await client
        .call('POST', '/internal/x', { timeoutMs: 1000 })
        .catch((error) => error);

      expect(failure).toBeInstanceOf(ServiceCallError);
      expect(failure.status).toBe(0);
    });
  });
});
