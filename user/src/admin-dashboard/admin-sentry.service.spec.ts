import { AdminSentryService } from './admin-sentry.service';

describe('admin Sentry feed', () => {
  const saved = process.env;
  beforeEach(() => {
    process.env = {
      ...saved,
      ADMIN_SENTRY_TOKEN: 'private-token',
      ADMIN_SENTRY_ORGANIZATION: 'my-org',
      ADMIN_SENTRY_ENVIRONMENT: 'production',
      ADMIN_SENTRY_PROJECT_IDS: '12,34',
    };
  });
  afterEach(() => {
    process.env = saved;
    jest.restoreAllMocks();
  });
  it.each(['logs', 'errors'] as const)(
    'scopes %s to configured projects and environment, and returns only display fields',
    async (dataset) => {
      jest.spyOn(global, 'fetch').mockImplementation(async (input, options) => {
        const url = new URL(
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        );
        expect(url.searchParams.get('dataset')).toBe(dataset);
        expect(url.searchParams.getAll('project')).toEqual(['12', '34']);
        expect(url.searchParams.get('environment')).toBe('production');
        expect(url.searchParams.get('cursor')).toBe('opaque:cursor');
        expect(options?.signal).toBeInstanceOf(AbortSignal);
        return Response.json(
          {
            data: [
              {
                id: 'one',
                timestamp: '2026-01-01T01:00:00.000Z',
                'project.name': 'api',
                severity: 'warn',
                level: 'error',
                message: 'a log',
                title: 'an error',
                request: { password: 'private' },
              },
            ],
          },
          {
            headers: {
              link: '<https://sentry.io/api/0/events/?cursor=next%3Apage>; rel="next"; results="true"',
            },
          },
        );
      });
      const result = await new AdminSentryService().logs({
        dataset,
        cursor: 'opaque:cursor',
      });
      expect(result.nextCursor).toBe('next:page');
      expect(result.entries[0]).toEqual({
        id: 'api:one',
        timestamp: '2026-01-01T01:00:00.000Z',
        project: 'api',
        level: dataset === 'logs' ? 'warn' : 'error',
        message: dataset === 'logs' ? 'a log' : 'an error',
      });
      expect(JSON.stringify(result)).not.toContain('private');
    },
  );
  it('keeps disconnected separate from a failed provider, without exposing provider errors', async () => {
    const fetcher = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        Response.json({ error: 'private token' }, { status: 403 }),
      );
    await expect(
      new AdminSentryService().logs({ dataset: 'logs' }),
    ).rejects.toThrow('Sentry logs could not be loaded');
    delete process.env.ADMIN_SENTRY_ENVIRONMENT;
    expect(
      (await new AdminSentryService().logs({ dataset: 'logs' })).status,
    ).toBe('not_configured');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
