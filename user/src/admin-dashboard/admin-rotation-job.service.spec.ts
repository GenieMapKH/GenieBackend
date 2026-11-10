import { RedisConnection } from '@tilomnov/shared';
import { AdminRotationJobService } from './admin-rotation-job.service';

describe('admin force rotation', () => {
  const saved = process.env;
  const client = { exists: jest.fn(), set: jest.fn() };
  const service = new AdminRotationJobService({
    client,
  } as unknown as RedisConnection);
  beforeEach(() => {
    process.env = {
      ...saved,
      ADMIN_ROTATION_GITHUB_REPOSITORY: 'owner/backend',
      ADMIN_ROTATION_GITHUB_REF: 'production',
      ADMIN_ROTATION_GITHUB_TOKEN: 'private',
    };
    client.exists.mockResolvedValue(0);
    client.set.mockResolvedValue('OK');
  });
  afterEach(() => {
    process.env = saved;
    jest.restoreAllMocks();
    jest.resetAllMocks();
  });

  it('dispatches only the fixed rotation workflow, forces all managed credentials, and returns acceptance', async () => {
    const fetcher = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (input, options) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.includes('/runs?')) return Response.json({ workflow_runs: [] });
        expect(url).toBe(
          'https://api.github.com/repos/owner/backend/actions/workflows/secret-rotation.yml/dispatches',
        );
        expect(JSON.parse(options!.body as string)).toEqual({
          ref: 'production',
          inputs: { force: true, dry_run: false, only: '', bootstrap: true },
        });
        return Response.json({ workflow_run_id: 42 });
      });
    expect(await service.force()).toEqual({ status: 'accepted', runId: 42 });
    expect(client.set).toHaveBeenCalledWith(
      'admin:production:operation',
      'rotation',
      'EX',
      120,
      'NX',
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('refuses another dispatch when a workflow is already waiting or running', async () => {
    const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(
      Response.json({
        workflow_runs: [
          {
            id: 1,
            status: 'queued',
            conclusion: null,
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    );
    await expect(service.force()).rejects.toThrow('already queued or running');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.set).not.toHaveBeenCalled();
  });
  it('fails closed when another admin already holds the operation lock', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () => Response.json({ workflow_runs: [] }));
    client.set.mockResolvedValue(null);
    await expect(service.force()).rejects.toThrow(
      'operation was just requested',
    );
  });

  it('does not lock or dispatch without complete configuration', async () => {
    delete process.env.ADMIN_ROTATION_GITHUB_TOKEN;
    const fetcher = jest.spyOn(global, 'fetch');
    await expect(service.force()).rejects.toThrow('not connected');
    expect(client.set).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
