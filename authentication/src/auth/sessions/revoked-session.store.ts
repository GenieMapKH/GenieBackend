import { Inject, Injectable, Logger } from '@nestjs/common';
import { RedisConnection } from '../../redis/redis-connection';
import { ACCESS_TOKEN_TTL_SECONDS } from '../auth.constants';

/**
 * Read by the api-gateway and the user service (`revoked-sessions` in each):
 * the key and the channel must be spelled the same in all three.
 */
const KEY_PREFIX = 'sessions:revoked:';
const CHANNEL = 'sessions:revoked';

/**
 * The sessions that were ended while an access token of theirs was still valid.
 *
 * An access token is accepted on its signature alone, so by itself it would
 * keep working until it expires, up to 15 minutes after the device was signed
 * out. Everything that accepts an access token looks its session up here
 * first, which makes a sign-out take effect at once. An entry only has to
 * outlive the last access token of its session.
 *
 * Without Redis the check cannot be made and a signed-out device works until
 * its token expires, as it did before this existed. Its refresh token is
 * revoked in the database either way, so it can never renew.
 */
@Injectable()
export class RevokedSessionStore {
  private readonly logger = new Logger(RevokedSessionStore.name);

  constructor(
    @Inject(RedisConnection) private readonly redis: RedisConnection,
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

  async has(sessionId: string): Promise<boolean> {
    try {
      return (await this.redis.client.exists(KEY_PREFIX + sessionId)) === 1;
    } catch {
      // Refusing everyone while Redis is down would be an outage of our own making.
      return false;
    }
  }
}
