import { Inject, Injectable, Logger } from '@nestjs/common';
import { RedisConnection } from '../../redis/redis-connection';
import { ACCESS_TOKEN_TTL_SECONDS } from '../auth.constants';
import { PrismaService } from '@tilomnov/shared';

/**
 * Read by the api-gateway and the user service (`revoked-sessions` in each):
 * the key and the channel must be spelled the same in all three.
 */
const KEY_PREFIX = 'sessions:revoked:';
const CHANNEL = 'sessions:revoked';

/** Durable session validity; Redis markers and pub/sub only accelerate disconnection. */
@Injectable()
export class RevokedSessionStore {
  private readonly logger = new Logger(RevokedSessionStore.name);

  constructor(
    @Inject(RedisConnection) private readonly redis: RedisConnection,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /** Cuts these sessions off now, and tells the chat servers to drop their connections. */
  async add(sessionIds: string[]): Promise<void> {
    for (const sessionId of new Set(sessionIds)) {
      try {
        await this.redis.client.set(
          KEY_PREFIX + sessionId,
          '1',
          'EX',
          ACCESS_TOKEN_TTL_SECONDS,
        );
        await this.redis.client.publish(CHANNEL, sessionId);
      } catch (error) {
        this.logger.error(
          `Session ${sessionId} could not be cut off at once: ${(error as Error).message}`,
        );
      }
    }
  }

  async has(sessionId: string, userId?: string): Promise<boolean> {
    // Rotation and revocation commit together, so a live row is durable session authority.
    const row = await this.prisma.refreshToken.findFirst({
      where: {
        sessionId,
        ...(userId && { userId }),
        revoked: false,
        expiresAt: { gt: new Date() },
        user: { bannedAt: null, deactivatedAt: null },
      },
      select: { id: true },
    });
    return row === null;
  }
}
