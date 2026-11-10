import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { Server, ServerOptions } from 'socket.io';
import { pubSubRedisOptions, redisUrl } from '@tilomnov/shared';

/**
 * Lets several instances of this service act as one chat server: a message
 * emitted on one instance reaches sockets connected to another, and "who is
 * online" is answered across all of them. Sockets on the same instance keep
 * reaching each other while Redis is unavailable.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private readonly publisher: Redis;
  private readonly subscriber: Redis;

  constructor(app: INestApplicationContext) {
    super(app);
    // These two queue commands while reconnecting, so subscriptions survive an outage.
    this.publisher = new Redis(redisUrl(), pubSubRedisOptions);
    this.subscriber = this.publisher.duplicate();
    for (const connection of [this.publisher, this.subscriber]) {
      // Logged once per outage, not once per reconnect attempt.
      let healthy = true;
      connection.on('error', (error: Error & { code?: string }) => {
        if (healthy)
          this.logger.error(
            `Chat Redis unavailable, retrying: ${error.message || error.code || 'cannot connect'}`,
          );
        healthy = false;
      });
      connection.on('ready', () => {
        if (!healthy) this.logger.log('Chat Redis is available again');
        healthy = true;
      });
    }
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    server.adapter(createAdapter(this.publisher, this.subscriber));
    return server;
  }

  async close(server: Server): Promise<void> {
    await super.close(server);
    this.publisher.disconnect();
    this.subscriber.disconnect();
  }
}
