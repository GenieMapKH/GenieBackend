import { ServerResponse } from 'http';
import { respondUnavailable } from './upstream-unavailable';
import {
  exactRoutesFor,
  routesFor,
  SERVICE_ROUTES,
  serviceUrlsFromEnv,
} from './service-routes';

/** The service a path is forwarded to, and whether the gateway demands a JWT for it. */
function resolve(path: string) {
  const matches = ({ path: pattern }: { path: string }) =>
    pattern.endsWith('/{*path}')
      ? path.startsWith(pattern.slice(0, -'{*path}'.length))
      : path === pattern;
  const route = SERVICE_ROUTES.find(
    (candidate) =>
      routesFor(candidate.prefixes).some(matches) &&
      !exactRoutesFor(candidate.exclude ?? []).some(matches),
  );
  const webhook = SERVICE_ROUTES.find((candidate) =>
    exactRoutesFor(candidate.alsoPublic ?? []).some(matches),
  );
  const chosen = webhook ?? route;
  return (
    chosen && { service: chosen.service, authenticated: chosen.authenticated }
  );
}

const ROUTED: [string, string, boolean][] = [
  ['/auth/login', 'auth', false],
  ['/auth/sessions', 'auth', false],
  ['/public/properties/map', 'property', false],
  ['/public/search', 'property', false],
  ['/properties', 'property', true],
  ['/properties/123/images', 'property', true],
  ['/search/history', 'property', true],
  ['/feed', 'property', true],
  ['/users/123/follow', 'user', true],
  ['/payments/checkout', 'payment', true],
  ['/payments/webhook', 'payment', false],
  ['/users/me', 'user', true],
  ['/reports', 'user', true],
  ['/reports/admin/123', 'user', true],
  ['/chat/conversations', 'chat', true],
  ['/notifications/devices', 'notification', true],
  ['/notifications/promotions', 'notification', true],
];

describe('where the gateway sends each path', () => {
  it.each(ROUTED)(
    '%s goes to %s (JWT required: %s)',
    (path, service, authenticated) => {
      expect(resolve(path)).toEqual({ service, authenticated });
    },
  );

  it.each(ROUTED)(
    '/v1%s goes to the same service, with the same JWT rule',
    (path, service, authenticated) => {
      expect(resolve(`/v1${path}`)).toEqual({ service, authenticated });
    },
  );

  it('does not route a version nobody serves', () => {
    expect(resolve('/v9/properties')).toBeUndefined();
  });

  it('never forwards /internal, which only the services may call', () => {
    expect(resolve('/internal/accounts/1/files')).toBeUndefined();
    expect(resolve('/v1/internal/accounts/1/files')).toBeUndefined();
  });

  it('lets only the chat service take WebSocket upgrades', () => {
    expect(
      SERVICE_ROUTES.filter((route) => route.websocket).map(
        (route) => route.service,
      ),
    ).toEqual(['chat']);
  });

  it('forwards each prefix as itself and as a parent of deeper paths, unversioned and under /v1', () => {
    expect(routesFor(['/chat']).map((route) => route.path)).toEqual([
      '/chat',
      '/chat/{*path}',
      '/v1/chat',
      '/v1/chat/{*path}',
    ]);
  });

  it('reads the service addresses from the environment, with local defaults', () => {
    expect(
      serviceUrlsFromEnv({ CHAT_SERVICE_URL: 'http://chat.internal:4004' }),
    ).toMatchObject({
      chat: 'http://chat.internal:4004',
      property: 'http://localhost:4003',
      payment: 'http://localhost:4005',
      notification: 'http://localhost:4006',
    });
  });
});

describe('when a service cannot be reached', () => {
  function response(headersSent = false) {
    return {
      headersSent,
      writeHead: jest.fn(),
      end: jest.fn(),
    } as unknown as ServerResponse & { writeHead: jest.Mock; end: jest.Mock };
  }

  it('answers 503 and names the service, so the app can tell which feature is down', () => {
    const res = response();

    respondUnavailable(
      'chat',
      Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
      res,
    );

    expect(res.writeHead).toHaveBeenCalledWith(
      503,
      expect.objectContaining({ 'retry-after': '5' }),
    );
    expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({
      statusCode: 503,
      service: 'chat',
    });
  });

  it('answers 504 for a service that took too long', () => {
    const res = response();

    respondUnavailable(
      'property',
      Object.assign(new Error('timeout'), { code: 'ECONNRESET' }),
      res,
    );

    expect(res.writeHead).toHaveBeenCalledWith(504, expect.anything());
  });

  it('only ends a response that has already started', () => {
    const res = response(true);

    respondUnavailable('user', new Error('gone'), res);

    expect(res.writeHead).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
  });

  it('closes the socket of a WebSocket upgrade instead of writing a response', () => {
    const socket = { destroy: jest.fn() };

    respondUnavailable('chat', new Error('gone'), socket);

    expect(socket.destroy).toHaveBeenCalled();
  });
});
