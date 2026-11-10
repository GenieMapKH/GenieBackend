import { Injectable } from '@nestjs/common';
import { RedisConnection } from './redis-connection';

/**
 * Short-lived copies of values that are read far more often than they change.
 * The database stays the source of truth: when Redis cannot answer, a read is
 * simply a miss and a write is skipped. (The outage itself is logged once by
 * RedisConnection.)
 *
 * Keys must name whose data it is. Never cache by URL: two users asking the
 * same URL must not be able to receive each other's answer.
 */
@Injectable()
export class JsonCache {
  constructor(private readonly connection: RedisConnection) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.connection.client.get(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  }

  /** Several values in one round trip, in the order of `keys`; null where missing. */
  async getMany<T>(keys: string[]): Promise<(T | null)[]> {
    if (keys.length === 0) return [];
    try {
      const raws = await this.connection.client.mget(...keys);
      return raws.map((raw) => (raw === null ? null : (JSON.parse(raw) as T)));
    } catch {
      return keys.map(() => null);
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.connection.client.set(
        key,
        JSON.stringify(value),
        'EX',
        ttlSeconds,
      );
    } catch {
      // Not cached this time; the next read loads it again.
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.connection.client.del(key);
    } catch {
      // The entry then lives until its (short) expiry.
    }
  }

  /** Adds one to a counter. Used as a version number that outdates a group of keys at once. */
  async increment(key: string): Promise<void> {
    try {
      await this.connection.client.incr(key);
    } catch {
      // Entries under the old version then live until their (short) expiry.
    }
  }

  /**
   * The cached value, or the result of `load`, which is then kept for
   * `ttlSeconds`. A cached value went through JSON: dates come back as strings,
   * exactly as they would in the HTTP response.
   */
  async remember<T>(
    key: string,
    ttlSeconds: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const fresh = await load();
    await this.set(key, fresh, ttlSeconds);
    return fresh;
  }
}
