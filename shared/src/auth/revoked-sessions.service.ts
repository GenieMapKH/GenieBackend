import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import {
  pubSubRedisOptions,
  RedisConnection,
  redisUrl,
} from '../redis/redis-connection';

/** Written by the authentication service (`RevokedSessionStore`): spelled the same there. */
const KEY_PREFIX = 'sessions:revoked:';
const CHANNEL = 'sessions:revoked';

/**
 * The sessions that were signed out while their access token had not expired.
 * A token is valid on its signature alone, so this is what makes a sign-out
 * immediate: such a token is refused, and its open connections are closed.
 *
 * While Redis is unavailable nothing is refused here, and a signed-out device
 * keeps working until its token expires (at most 15 minutes).
 */
@Injectable()
export class RevokedSessions implements OnModuleInit, OnModuleDestroy {
  private subscriber?: Redis;
  private readonly listeners: ((sessionId: string) => void)[] = [];

  constructor(private readonly connection: RedisConnection) {}

  async has(sessionId: string): Promise<boolean> {
    try {
      return (
        (await this.connection.client.exists(KEY_PREFIX + sessionId)) === 1
      );
    } catch {
      return false;
    }
  }

  /** Calls `listener` with each session, the moment it is signed out. */
  onRevoked(listener: (sessionId: string) => void): void {
    this.listeners.push(listener);
  }

  onModuleInit() {
    // A subscribed connection can do nothing else, so it is a second one. It
    // queues the subscription while Redis is unreachable and restores it after
    // a reconnect.
    this.subscriber = new Redis(redisUrl(), pubSubRedisOptions);
    // An outage is already reported once by RedisConnection.
    this.subscriber.on('error', () => undefined);
    this.subscriber.on('message', (_channel: string, sessionId: string) => {
      for (const listener of this.listeners) listener(sessionId);
    });
    void this.subscriber.subscribe(CHANNEL).catch(() => undefined);
  }

  onModuleDestroy() {
    this.subscriber?.disconnect();
  }
}
