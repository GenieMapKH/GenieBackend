import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RedisConnection } from '@tilomnov/shared';
import { IsUUID } from 'class-validator';
import { ModerationReasonDto } from './admin-moderation.dto';

export class AdminRollbackDto extends ModerationReasonDto {
  @IsUUID() deploymentId: string;
  @IsUUID() expectedLatestId: string;
}
type Deployment = {
  id: string;
  status: string;
  createdAt: string;
  canRollback: boolean;
  meta?: { commitHash?: string };
};
type ServiceDeployments = {
  latest: Deployment | null;
  deployments: { edges: { node: Deployment }[] };
};

@Injectable()
export class AdminDeploymentsService {
  constructor(private readonly redis: RedisConnection) {}

  private config() {
    const token = process.env.ADMIN_RAILWAY_PROJECT_TOKEN;
    const projectId = process.env.ADMIN_RAILWAY_PROJECT_ID;
    const environmentId = process.env.ADMIN_RAILWAY_ENVIRONMENT_ID;
    let services: Record<string, string> = {};
    try {
      services = JSON.parse(
        process.env.ADMIN_RAILWAY_SERVICE_IDS || '{}',
      ) as Record<string, string>;
    } catch {
      return null;
    }
    const allowed = [
      'api-gateway',
      'authentication',
      'user',
      'property',
      'chat',
      'payment',
      'notification',
    ];
    if (
      !token ||
      !projectId ||
      !environmentId ||
      !services ||
      !Object.keys(services).length ||
      Object.entries(services).some(
        ([name, id]) =>
          !allowed.includes(name) ||
          typeof id !== 'string' ||
          !/^[0-9a-f-]{36}$/i.test(id),
      )
    )
      return null;
    return { token, projectId, environmentId, services };
  }

  private async request<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const config = this.config();
    if (!config)
      throw new ServiceUnavailableException(
        'Production recovery is not connected',
      );
    try {
      const response = await fetch('https://backboard.railway.com/graphql/v2', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'project-access-token': config.token,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('Railway HTTP failure');
      const body = (await response.json()) as { data?: T; errors?: unknown[] };
      if (body.errors?.length || !body.data)
        throw new Error('Railway GraphQL failure');
      return body.data;
    } catch {
      throw new ServiceUnavailableException(
        'Could not confirm the Railway operation. Refresh deployments before trying again.',
      );
    }
  }

  private async service(name: string) {
    const config = this.config();
    const serviceId = config?.services[name];
    if (!config || !serviceId)
      throw new ConflictException(
        'Service is not enabled for production recovery',
      );
    // shortcut: inspect the latest 20 deployments; paginate when recovery needs older retained releases.
    const data = await this.request<{
      serviceInstance: { latestDeployment: Deployment | null };
      deployments: ServiceDeployments['deployments'];
    }>(
      `
      query($serviceId: String!, $environmentId: String!, $input: DeploymentListInput!) {
        serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
          latestDeployment { id status createdAt canRollback meta }
        }
        deployments(input: $input, first: 20) { edges { node { id status createdAt canRollback meta } } }
      }`,
      {
        serviceId,
        environmentId: config.environmentId,
        input: {
          projectId: config.projectId,
          environmentId: config.environmentId,
          serviceId,
        },
      },
    );
    const latest = data.serviceInstance.latestDeployment;
    const previous =
      data.deployments.edges
        .map((edge) => edge.node)
        .filter(
          (d) =>
            d.id !== latest?.id &&
            d.canRollback &&
            latest &&
            Date.parse(d.createdAt) < Date.parse(latest.createdAt),
        )
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ??
      null;
    const summary = (d: Deployment | null) =>
      d
        ? {
            id: d.id,
            status: d.status,
            createdAt: d.createdAt,
            commit:
              typeof d.meta?.commitHash === 'string'
                ? d.meta.commitHash.slice(0, 12)
                : null,
          }
        : null;
    return { name, latest: summary(latest), previous: summary(previous) };
  }

  async status() {
    const config = this.config();
    if (!config)
      return {
        status: 'not_configured',
        services: [],
        checkedAt: new Date().toISOString(),
      };
    const services = await Promise.all(
      Object.keys(config.services).map((name) => this.service(name)),
    );
    return { status: 'ok', services, checkedAt: new Date().toISOString() };
  }

  async rollback(name: string, dto: AdminRollbackDto) {
    const locked = await this.redis.client.set(
      'admin:production:operation',
      'rollback',
      'EX',
      120,
      'NX',
    );
    if (!locked)
      throw new ConflictException(
        'Another recovery was just requested. Refresh deployments.',
      );
    const service = await this.service(name);
    if (
      service.latest?.id !== dto.expectedLatestId ||
      service.previous?.id !== dto.deploymentId
    )
      throw new ConflictException(
        'Deployments changed. Refresh and review the rollback target.',
      );
    if (
      !['SUCCESS', 'FAILED', 'CRASHED', 'REMOVED', 'SKIPPED'].includes(
        service.latest.status,
      )
    )
      throw new ConflictException(
        'A deployment is in progress. Wait for it to finish.',
      );
    const snapshot = async (id: string) =>
      (
        await this.request<{
          deploymentSnapshot: {
            variables: Record<string, string>;
            variablesRedacted: boolean;
          } | null;
        }>(
          `
        query($id: String!) { deploymentSnapshot(deploymentId: $id) { variables variablesRedacted } }
      `,
          { id },
        )
      ).deploymentSnapshot;
    const [current, target] = await Promise.all([
      snapshot(dto.expectedLatestId),
      snapshot(dto.deploymentId),
    ]);
    const keys = [
      'DATABASE_URL',
      'INTERNAL_SERVICE_SECRET',
      'INTERNAL_SERVICE_SECRET_PREVIOUS',
      'JWT_KEY_ENCRYPTION_KEY',
      'RABBITMQ_URL',
    ];
    if (
      !current ||
      !target ||
      current.variablesRedacted ||
      target.variablesRedacted ||
      keys.some((key) => current.variables[key] !== target.variables[key])
    )
      throw new ConflictException(
        'This rollback would restore different credentials. Redeploy the old code with current credentials from Railway instead.',
      );
    const result = await this.request<{ deploymentRollback: boolean }>(
      'mutation($id: String!) { deploymentRollback(id: $id) }',
      { id: dto.deploymentId },
    );
    if (!result.deploymentRollback)
      throw new ServiceUnavailableException(
        'Railway did not accept the rollback',
      );
    return { status: 'accepted' };
  }
}
