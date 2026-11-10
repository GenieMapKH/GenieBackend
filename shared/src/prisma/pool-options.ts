/** How one service's connection pool to the database behaves. */
export interface PoolOptions {
  max: number;
  min: number;
  idleTimeoutMillis: number;
  keepAlive: boolean;
}

/**
 * Pool settings from the environment. Every service has its own pool, and
 * all of them share the database's connection limit (see docs/RAILWAY.md).
 *
 * - `DATABASE_POOL_MAX`: most connections at once (default 2). Six services
 *   share 15 session slots; leave capacity for rolling deploys and tools.
 * - `DATABASE_POOL_MIN`: connections kept open while idle (default 0). Opening
 *   one costs a TLS handshake and a login: about 0.4 s when the database is
 *   far away, as it is from a developer's machine. Kept connections also hold
 *   a place in the database's limit, so production leaves this at 0 unless
 *   it has room.
 * - `DATABASE_POOL_IDLE_SECONDS`: how long a connection beyond the minimum
 *   stays open unused (default 10, the driver's own default).
 */
export function poolOptions(env: NodeJS.ProcessEnv = process.env): PoolOptions {
  const max = positiveInt(env.DATABASE_POOL_MAX) ?? 2;
  const min = Math.min(nonNegativeInt(env.DATABASE_POOL_MIN) ?? 0, max);
  const idleSeconds = positiveInt(env.DATABASE_POOL_IDLE_SECONDS) ?? 10;
  // Keepalive stops a connection kept open from being dropped silently by
  // routers along the way.
  return { max, min, idleTimeoutMillis: idleSeconds * 1000, keepAlive: true };
}

function nonNegativeInt(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return value !== undefined &&
    value !== '' &&
    Number.isInteger(parsed) &&
    parsed >= 0
    ? parsed
    : undefined;
}

function positiveInt(value: string | undefined): number | undefined {
  const parsed = nonNegativeInt(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}
