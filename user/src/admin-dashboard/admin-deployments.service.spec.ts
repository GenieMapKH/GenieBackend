import { RedisConnection } from '@tilomnov/shared';
import { AdminDeploymentsService } from './admin-deployments.service';

describe('admin production recovery', () => {
  const saved = process.env;
  const latestId = '00000000-0000-4000-8000-000000000001';
  const oldId = '00000000-0000-4000-8000-000000000002';
  const serviceId = '00000000-0000-4000-8000-000000000003';
  const client = { set: jest.fn() };
  const service = new AdminDeploymentsService({
    client,
  } as unknown as RedisConnection);
  const dto = {
    deploymentId: oldId,
    expectedLatestId: latestId,
    reason: 'Recover service',
  };
  let credentialsChanged: boolean;
  let graphqlFailure: boolean;
  let requests: { query: string; variables: Record<string, unknown> }[];
  beforeEach(() => {
    process.env = {
      ...saved,
      ADMIN_RAILWAY_PROJECT_TOKEN: 'private',
      ADMIN_RAILWAY_PROJECT_ID: 'project',
      ADMIN_RAILWAY_ENVIRONMENT_ID: 'production',
      ADMIN_RAILWAY_SERVICE_IDS: JSON.stringify({ user: serviceId }),
    };
    credentialsChanged = false;
    graphqlFailure = false;
    requests = [];
    client.set.mockResolvedValue('OK');
    jest.spyOn(global, 'fetch').mockImplementation(async (_, options) => {
      const body = JSON.parse(
        options!.body as string,
      ) as (typeof requests)[number];
      requests.push(body);
      if (graphqlFailure)
        return Response.json({ errors: [{ message: 'private' }] });
      if (body.query.includes('serviceInstance(')) {
        expect(body.variables.input).toEqual({
          projectId: 'project',
          environmentId: 'production',
          serviceId,
        });
        return Response.json({
          data: {
            serviceInstance: {
              latestDeployment: {
                id: latestId,
                status: 'CRASHED',
                createdAt: '2026-02-01T00:00:00Z',
                canRollback: false,
              },
            },
            deployments: {
              edges: [
                {
                  node: {
                    id: oldId,
                    status: 'REMOVED',
                    createdAt: '2026-01-01T00:00:00Z',
                    canRollback: true,
                    meta: {
                      commitHash: '1234567890123456',
                      privateValue: 'private',
                    },
                  },
                },
              ],
            },
          },
        });
      }
      if (body.query.includes('deploymentSnapshot('))
        return Response.json({
          data: {
            deploymentSnapshot: {
              variablesRedacted: false,
              variables: {
                DATABASE_URL:
                  credentialsChanged && body.variables.id === oldId
                    ? 'old'
                    : 'current',
              },
            },
          },
        });
      return Response.json({ data: { deploymentRollback: true } });
    });
  });
  afterEach(() => {
    process.env = saved;
    jest.restoreAllMocks();
  });
  it('restores only the reviewed target in the configured environment', async () => {
    expect(await service.rollback('user', dto)).toEqual({ status: 'accepted' });
    expect(requests[requests.length - 1]).toEqual({
      query: 'mutation($id: String!) { deploymentRollback(id: $id) }',
      variables: { id: oldId },
    });
    const status = await service.status();
    expect(status.services[0].previous?.commit).toBe('123456789012');
    expect(JSON.stringify(status)).not.toContain('private');
  });
  it.each([
    'stale',
    'other-service',
    'changed-credentials',
    'graphql-error',
    'locked',
  ])('does not issue a rollback for %s', async (failure) => {
    credentialsChanged = failure === 'changed-credentials';
    graphqlFailure = failure === 'graphql-error';
    if (failure === 'locked') client.set.mockResolvedValue(null);
    await expect(
      service.rollback(failure === 'other-service' ? 'unknown' : 'user', {
        ...dto,
        ...(failure === 'stale' ? { expectedLatestId: oldId } : {}),
      }),
    ).rejects.toThrow();
    expect(requests.some((r) => r.query.startsWith('mutation'))).toBe(false);
  });
});
