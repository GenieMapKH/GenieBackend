import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  PrismaService,
  ServiceClient,
  ServiceCallError,
} from '@tilomnov/shared';

@Injectable()
export class AdminPlatformService {
  private readonly properties = new ServiceClient(
    'property',
    process.env.PROPERTY_SERVICE_URL || 'http://localhost:4003',
    'user',
  );
  private readonly auth = new ServiceClient(
    'authentication',
    process.env.AUTH_SERVICE_URL || 'http://localhost:4001',
    'user',
  );
  constructor(private readonly prisma: PrismaService) {}

  property<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    return this.call<T>(
      this.properties,
      method,
      `/internal/admin/${path}`,
      body,
    );
  }

  async account(
    actorId: string,
    id: string,
    action: 'ban' | 'delete',
    reason: string,
  ) {
    if (actorId === id)
      throw new HttpException('You cannot moderate your own account', 403);
    return this.mutate(actorId, id, `account.${action}`, reason, () =>
      this.call(
        this.auth,
        action === 'ban' ? 'POST' : 'DELETE',
        `/internal/admin/accounts/${id}${action === 'ban' ? '/ban' : ''}`,
      ),
    );
  }

  async mutate<T>(
    actorId: string,
    targetId: string,
    action: string,
    reason: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const audit = await this.prisma.moderationAction.create({
      data: { actorId, targetId, action, reason },
    });
    let result: T;
    try {
      result = await work();
    } catch (error) {
      await this.prisma.moderationAction.update({
        where: { id: audit.id },
        data: { status: 'failed' },
      });
      throw error;
    }
    await this.prisma.moderationAction.update({
      where: { id: audit.id },
      data: { status: 'completed' },
    });
    return result;
  }

  private async call<T>(
    client: ServiceClient,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    try {
      return await client.call<T>(method, path, { body, timeoutMs: 90000 });
    } catch (error) {
      if (
        error instanceof ServiceCallError &&
        error.status >= 400 &&
        error.status < 500
      )
        throw new HttpException(error.message, error.status);
      throw new ServiceUnavailableException(
        'The action could not be completed. Please try again.',
      );
    }
  }
}
