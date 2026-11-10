import { createHash } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { RedisConnection } from '../../redis/redis-connection';

const KEY_PREFIX = 'login:known-devices:';

/** A device that has not signed in for this long has to earn its place again. */
const KNOWN_FOR_SECONDS = 180 * 24 * 60 * 60;

/**
 * The devices that have signed in to an account with its password. Each
 * device makes up a secret key of its own (`X-Device-Key`) and keeps it, so a
 * stranger cannot pretend to be one of them: they would have to know the key.
 *
 * Only hashes are stored, so a copy of Redis gives no keys away. Without
 * Redis no device is known, which only means the ordinary limits apply.
 */
@Injectable()
export class KnownLoginDevices {
  private readonly logger = new Logger(KnownLoginDevices.name);

  constructor(
    @Inject(RedisConnection) private readonly redis: RedisConnection,
  ) {}

  async isKnown(account: string, deviceKey: string | null): Promise<boolean> {
    if (!deviceKey) return false;
    try {
      return (
        (await this.redis.client.sismember(
          KEY_PREFIX + account,
          hashOf(deviceKey),
        )) === 1
      );
    } catch {
      return false;
    }
  }

  /** Called after a successful sign-in from this device. */
  async remember(account: string, deviceKey: string | null): Promise<void> {
    if (!deviceKey) return;
    const key = KEY_PREFIX + account;
    try {
      await this.redis.client
        .multi()
        .sadd(key, hashOf(deviceKey))
        .expire(key, KNOWN_FOR_SECONDS)
        .exec();
    } catch (error) {
      this.logger.warn(
        `Device not remembered for sign-in: ${(error as Error).message}`,
      );
    }
  }
}

function hashOf(deviceKey: string): string {
  return createHash('sha256').update(deviceKey).digest('hex');
}
