import { AdminSystemHealthService } from './admin-system-health.service';

describe('admin service status', () => {
  const environment = process.env;
  const service = new AdminSystemHealthService();
  beforeEach(() => {
    process.env = {
      ...environment,
      NODE_ENV: 'production',
      GATEWAY_SERVICE_URL: 'http://gateway',
      AUTH_SERVICE_URL: 'http://auth',
      USER_SERVICE_URL: 'http://user',
      PROPERTY_SERVICE_URL: 'http://property',
      CHAT_SERVICE_URL: 'http://chat',
      PAYMENT_SERVICE_URL: 'http://payment',
      NOTIFICATION_SERVICE_URL: 'http://notification',
    };
  });
  afterEach(() => {
    process.env = environment;
    jest.restoreAllMocks();
  });

  it('keeps every service result when one errors and another cannot be reached', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      const address =
        typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      if (address.includes('chat')) throw new Error('unreachable');
      if (address.includes('payment'))
        return Response.json({}, { status: 503 });
      return Response.json({ status: 'ok' });
    });
    const health = await service.check();
    expect(health.services).toHaveLength(7);
    expect(health.services.find((item) => item.name === 'Chat')?.status).toBe(
      'down',
    );
    expect(
      health.services.find((item) => item.name === 'Payments'),
    ).toMatchObject({ status: 'down', httpStatus: 503 });
    expect(health.services.filter((item) => item.status === 'up')).toHaveLength(
      5,
    );
    expect(health.checkedAt).toEqual(expect.any(String));
    expect(JSON.stringify(health)).not.toContain('http://');
  });

  it('distinguishes an unconfigured production address from a failed service', async () => {
    delete process.env.GATEWAY_SERVICE_URL;
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(Response.json({ status: 'ok' }));
    // Each call needs a fresh response body.
    fetch.mockImplementation(async () => Response.json({ status: 'ok' }));
    const health = await service.check();
    expect(health.services[0]).toEqual({
      name: 'API gateway',
      status: 'not_configured',
      latencyMs: null,
    });
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('does not accept an unrelated HTTP 200 response as a healthy service', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () => Response.json({ status: 'error' }));
    expect(
      (await service.check()).services.every((item) => item.status === 'down'),
    ).toBe(true);
  });
});
