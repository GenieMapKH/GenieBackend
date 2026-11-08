import express from 'express';
import request from 'supertest';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { createRateLimitMiddleware } from './rate-limit.middleware';
import { trustedProxies } from './trusted-proxies';

describe('proxy trust', () => {
  it('cannot rotate a direct connection rate limit through forwarding headers', async () => {
    const app = express();
    app.set('trust proxy', trustedProxies({}));
    app.use(
      createRateLimitMiddleware(
        new RateLimiterMemory({ points: 1, duration: 60 }),
      ),
    );
    app.get('/check', (_req, res) => res.sendStatus(200));
    await request(app)
      .get('/check')
      .set('X-Forwarded-For', '198.51.100.1')
      .expect(200);
    await request(app)
      .get('/check')
      .set('X-Forwarded-For', '198.51.100.2')
      .expect(429);
  });

  it('uses forwarding headers only through a configured ingress', async () => {
    const app = express();
    app.set(
      'trust proxy',
      trustedProxies({ TRUSTED_PROXIES: '127.0.0.1, ::1' }),
    );
    app.get('/check', (req, res) => res.json({ ip: req.ip }));
    const response = await request(app)
      .get('/check')
      .set('X-Forwarded-For', '198.51.100.1')
      .expect(200);
    expect(response.body).toEqual({ ip: '198.51.100.1' });
  });
});
