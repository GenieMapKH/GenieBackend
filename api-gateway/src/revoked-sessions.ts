import { Injectable } from '@nestjs/common';
import { RedisConnection } from './redis-connection';

/** Written by the authentication service (`RevokedSessionStore`): spelled the same there. */
const KEY_PREFIX = 'sessions:revoked:';

/**
 * The sessions that were signed out while their access token had not expired.
 * These markers are a fast negative signal only; verifySignedToken separately
 * checks durable validity, even when this cache is empty.
 */
@Injectable()
export class RevokedSessions {
  constructor(private readonly redis: RedisConnection) {}

  async has(sessionId: string): Promise<boolean> {
    try {
      return (await this.redis.client.exists(KEY_PREFIX + sessionId)) === 1;
    } catch {
      // The independent durable check still decides whether the session is active.
      return false;
    }
  }
}
