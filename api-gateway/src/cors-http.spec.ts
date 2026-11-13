import corsMiddleware from 'cors';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { buildCorsOptions } from './cors.config';

describe('browser CORS boundary over HTTP', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    const cors = corsMiddleware(
      buildCorsOptions({
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.example',
      }),
    );
    server = createServer((req, res) => cors(req, res, () => res.end('ok')));
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  it('allows the exact web origin, explicit authorization and device headers, but not cookies or identity headers', async () => {
    const response = await fetch(base, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://app.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers':
          'authorization,x-device-key,x-user-id',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://app.example',
    );
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    const headers = response.headers
      .get('access-control-allow-headers')!
      .toLowerCase();
    expect(headers).toContain('authorization');
    expect(headers).toContain('x-device-key');
    expect(headers).not.toContain('x-user-id');
  });
  it.each([
    'https://untrusted.invalid',
    'https://app.example.attacker.invalid',
    'null',
    'http://app.example',
    'https://app.example:444',
  ])('does not grant browser access to %s', async (origin) => {
    const response = await fetch(base, {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'GET' },
    });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('keeps native clients without Origin working', async () => {
    const response = await fetch(base);
    expect(response.status).toBe(200);
  });
});
