import { Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { Redis } from 'ioredis';
import {
  RateLimiterMemory,
  RateLimiterRedis,
  RateLimiterRes,
} from 'rate-limiter-flexible';

/** What the middleware needs from a limiter: `consume` rejects once the key is over its limit. */
export interface RequestLimiter {
  consume(key: string): Promise<unknown>;
}

/**
 * Requests per client address, counted in Redis so every gateway instance
 * shares one count and a restart does not reset it. While Redis is unavailable
 * each instance counts in its own memory: the limit is never switched off.
 */
export function createRequestLimiter(
  redis: Redis,
  limit: number,
  windowSeconds: number,
): RequestLimiter {
  return new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: 'limit:gateway',
    points: limit,
    duration: windowSeconds,
    insuranceLimiter: new RateLimiterMemory({
      points: limit,
      duration: windowSeconds,
    }),
  });
}

/**
 * Limits how many requests one client address may make.
 *
 * It has to be a middleware placed before the service proxies: the proxies
 * answer the request themselves, so Nest guards never run for proxied routes.
 */
export function createRateLimitMiddleware(limiter: RequestLimiter) {
  const logger = new Logger('RateLimit');

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await limiter.consume(req.ip ?? 'unknown');
    } catch (rejected) {
      if (rejected instanceof RateLimiterRes) {
        res.setHeader('Retry-After', Math.ceil(rejected.msBeforeNext / 1000));
        res.status(429).json({
          statusCode: 429,
          message: 'Too many requests. Please slow down.',
        });
        return;
      }
      // The limiter itself failed. Refusing everyone would be an outage of our own making.
      logger.error(
        `Rate limit could not be checked: ${(rejected as Error).message}`,
      );
    }
    next();
  };
}
