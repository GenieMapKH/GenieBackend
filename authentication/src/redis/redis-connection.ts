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

/**
 * The connection used to count requests. Redis only makes those counts
 * shared between instances and lasting across restarts, so a command never waits for a
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
    retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
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
