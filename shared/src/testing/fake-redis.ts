import { RateLimiterMemory } from 'rate-limiter-flexible';
import { JsonCache } from '../redis/json-cache.service';
import { RateLimits } from '../redis/rate-limits.service';

/** The few Redis commands the services use, kept in a Map. `down` makes every command fail. */
export class FakeRedis {
  readonly values = new Map<string, string>();
  down = false;

  private run<T>(command: () => T): Promise<T> {
    return this.down
      ? Promise.reject(new Error('Redis is down'))
      : Promise.resolve(command());
  }

  get = (key: string) => this.run(() => this.values.get(key) ?? null);
  mget = (...keys: string[]) =>
    this.run(() => keys.map((key) => this.values.get(key) ?? null));
  set = (key: string, value: string) =>
    this.run(() => void this.values.set(key, value));
  del = (key: string) => this.run(() => void this.values.delete(key));
  incr = (key: string) =>
    this.run(
      () =>
        void this.values.set(
          key,
          String(Number(this.values.get(key) ?? 0) + 1),
        ),
    );
}

export function fakeCache(redis = new FakeRedis()): JsonCache {
  return new JsonCache({ client: redis } as never);
}

/** Limits counted in memory, as the real ones are while Redis is unavailable. */
export const memoryRateLimits = {
  create: (_name: string, points: number, duration: number) =>
    new RateLimiterMemory({ points, duration }),
} as unknown as RateLimits;
