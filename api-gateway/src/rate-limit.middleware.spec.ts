import { RateLimiterMemory } from 'rate-limiter-flexible';
import {
  createRateLimitMiddleware,
  RequestLimiter,
} from './rate-limit.middleware';

describe('rate limit middleware', () => {
  async function request(
    middleware: ReturnType<typeof createRateLimitMiddleware>,
    ip: string,
  ) {
    const res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();
    await middleware({ ip } as never, res as never, next);
    return { passed: next.mock.calls.length === 1, res };
  }

  const limitOf = (points: number) =>
    createRateLimitMiddleware(new RateLimiterMemory({ points, duration: 60 }));

  afterEach(() => {
    jest.useRealTimers();
  });

  it('lets a client through up to the limit, then answers 429', async () => {
    const middleware = limitOf(3);

    for (let i = 0; i < 3; i++)
      expect((await request(middleware, '1.1.1.1')).passed).toBe(true);

    const blocked = await request(middleware, '1.1.1.1');
    expect(blocked.passed).toBe(false);
    expect(blocked.res.status).toHaveBeenCalledWith(429);
    expect(blocked.res.setHeader).toHaveBeenCalledWith('Retry-After', 60);
  });

  it('counts each client address on its own', async () => {
    const middleware = limitOf(1);
    await request(middleware, '1.1.1.1');

    expect((await request(middleware, '1.1.1.1')).passed).toBe(false);
    expect((await request(middleware, '2.2.2.2')).passed).toBe(true);
  });

  it('starts over when the window ends', async () => {
    jest.useFakeTimers();
    const middleware = limitOf(1);
    await request(middleware, '1.1.1.1');
    expect((await request(middleware, '1.1.1.1')).passed).toBe(false);

    jest.advanceTimersByTime(61_000);
    expect((await request(middleware, '1.1.1.1')).passed).toBe(true);
  });

  it('lets requests through if the limiter itself breaks', async () => {
    const broken: RequestLimiter = {
      consume: () => Promise.reject(new Error('limiter crashed')),
    };

    expect(
      (await request(createRateLimitMiddleware(broken), '1.1.1.1')).passed,
    ).toBe(true);
  });
});
