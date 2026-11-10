import { Injectable } from '@nestjs/common';
import { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import { RedisConnection } from './redis-connection';

/** What callers need from a limiter: `consume` rejects once the key is over its limit. */
export interface RateLimit {
  consume(key: string): Promise<unknown>;
}

/**
 * Limits counted in Redis, so they hold across restarts and across several
 * instances. While Redis is unavailable each instance counts in its own memory
 * instead: a limit is never switched off.
 */
@Injectable()
export class RateLimits {
  constructor(private readonly connection: RedisConnection) {}

  create(name: string, points: number, durationSeconds: number): RateLimit {
    return new RateLimiterRedis({
      storeClient: this.connection.client,
      keyPrefix: `limit:${name}`,
      points,
      duration: durationSeconds,
      insuranceLimiter: new RateLimiterMemory({
        points,
        duration: durationSeconds,
      }),
    });
  }
}
