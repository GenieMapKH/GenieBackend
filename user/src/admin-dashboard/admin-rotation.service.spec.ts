import { AdminRotationService } from './admin-rotation.service';

describe('admin credential rotation status', () => {
  const saved = process.env;
  beforeEach(() => {
    process.env = {
      ...saved,
      ADMIN_INFISICAL_CLIENT_ID: 'reader',
      ADMIN_INFISICAL_CLIENT_SECRET: 'private',
      ADMIN_INFISICAL_PROJECT_ID: 'project',
      ADMIN_INFISICAL_ENVIRONMENT: 'prod',
    };
  });
  afterEach(() => {
    process.env = saved;
    jest.restoreAllMocks();
  });

  it('reads only the known timestamp records and preserves partial failures', async () => {
    const fetcher = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (input, options) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        expect(options?.signal).toBeInstanceOf(AbortSignal);
        if (url.endsWith('/login'))
          return Response.json({ accessToken: 'private-token' });
        expect(new URL(url).searchParams.get('secretPath')).toBe('/rotation');
        expect(url).toMatch(/\/secrets\/[A-Z]+_ROTATED_AT\?/);
        if (url.includes('USER_ROTATED_AT'))
          return Response.json({}, { status: 404 });
        if (url.includes('CHAT_ROTATED_AT'))
          return Response.json({}, { status: 403 });
        if (url.includes('PAYMENT_ROTATED_AT'))
          return Response.json({ secret: { secretValue: 'not a date' } });
        return Response.json({
          secret: { secretValue: '2026-01-01T00:00:00Z' },
          secretValue: 'DO NOT RETURN',
        });
      });
    const result = await new AdminRotationService().status();
    expect(fetcher).toHaveBeenCalledTimes(8);
    expect(result.credentials).toHaveLength(7);
    expect(result.credentials[0]).toMatchObject({
      status: 'recorded',
      lastRotatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.credentials[1].status).toBe('never_recorded');
    expect(result.credentials[3].status).toBe('unavailable');
    expect(result.credentials[4].status).toBe('unavailable');
    expect(JSON.stringify(result)).not.toMatch(
      /private|DO NOT RETURN|secretValue/,
    );
  });

  it('distinguishes missing configuration from provider failure without exposing errors', async () => {
    const fetcher = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('private credentials'));
    expect((await new AdminRotationService().status()).status).toBe(
      'unavailable',
    );
    delete process.env.ADMIN_INFISICAL_ENVIRONMENT;
    expect((await new AdminRotationService().status()).status).toBe(
      'not_configured',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
