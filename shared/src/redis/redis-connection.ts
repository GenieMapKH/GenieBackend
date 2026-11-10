import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';

export function redisUrl(): string {
  return process.env.REDIS_URL || 'redis://localhost:6379';
}

/** Wait before reconnect attempt `attempt`: 0.5s, 1s, 1.5s ... capped at 5s. Never gives up. */
export function reconnectDelay(attempt: number): number {
  return Math.min(attempt * 500, 5000);
}

/**
 * Options for the long-lived pub/sub connections (chat adapter, session
 * revocation). They queue commands while reconnecting and keep retrying
 * forever. ioredis's default of 20 retries per command would otherwise reject
 * the queued commands after about 80s of outage as an uncaught error, which
 * kills the process.
 */
export const pubSubRedisOptions = {
  maxRetriesPerRequest: null,
  retryStrategy: reconnectDelay,
} as const;

/**
 * The connection for ordinary commands (cache, rate limits). Redis only makes
 * things faster or shared between instances, so a command never waits for a
 * lost connection: it fails at once and the caller carries on without Redis.
 */
@Injectable()
export class RedisConnection implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisConnection.name);
  private healthy = true;

  readonly client = new Redis(redisUrl(), {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: reconnectDelay,
  });

  constructor() {
    // Logged once per outage, not once per failed command.
    this.client.on('error', (error: Error & { code?: string }) => {
      if (this.healthy)
        this.logger.error(
          `Redis is unavailable: ${error.message || error.code || 'cannot connect'}`,
        );
      this.healthy = false;
    });
    this.client.on('ready', () => {
      if (!this.healthy) this.logger.log('Redis is available again');
      this.healthy = true;
    });
  }

  async onModuleInit() {
    // A failed first connection is reported by the 'error' listener and retried.
    await this.client.connect().catch(() => undefined);
  }

  onModuleDestroy() {
    this.client.disconnect();
  }
}
