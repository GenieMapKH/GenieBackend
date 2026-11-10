import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync, randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { authKeySet, JwtStrategy, signServiceToken } from '@tilomnov/shared';
import { enableApiVersioning } from '@tilomnov/shared/api-versions';
import { PaymentsController } from './payments.controller';
import { PaymentCheckoutService } from './payment-checkout.service';
import { PaymentWebhookService } from './payment-webhook.service';
import {
  InternalSubscriptionsController,
  SubscriptionsController,
} from './subscriptions.controller';
import { SubscriptionService } from './subscription.service';

describe('payment API trust boundaries', () => {
  let app: INestApplication;
  const alice = randomUUID();
  const bob = randomUUID();
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const token = jwt.sign(
    { sub: alice, typ: 'access', role: 'user' },
    keys.privateKey,
    { algorithm: 'RS256', keyid: 'payment-test', expiresIn: 60 },
  );
  const subscriptions = {
    purchase: jest.fn(),
    quote: jest.fn(),
    current: jest.fn(),
    expired: jest.fn(),
    cancel: jest.fn(),
    allowance: jest.fn(),
    publishingEntitlements: jest.fn(),
  };

  beforeAll(async () => {
    process.env.INTERNAL_SERVICE_SECRET =
      'payment-api-tests-only-secret-32-characters';
    const fetchKeys = jest.spyOn(global, 'fetch').mockResolvedValue(
      Response.json({
        keys: [
          {
            ...keys.publicKey.export({ format: 'jwk' }),
            kid: 'payment-test',
            alg: 'RS256',
          },
        ],
      }),
    );
    await authKeySet().refresh();
    fetchKeys.mockRestore();
    const module = await Test.createTestingModule({
      controllers: [
        PaymentsController,
        SubscriptionsController,
        InternalSubscriptionsController,
      ],
      providers: [
        JwtStrategy,
        { provide: SubscriptionService, useValue: subscriptions },
        {
          provide: PaymentCheckoutService,
          useValue: { state: jest.fn(), initiate: jest.fn() },
        },
        { provide: PaymentWebhookService, useValue: { handle: jest.fn() } },
      ],
    }).compile();
    app = module.createNestApplication();
    enableApiVersioning(app);
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => app?.close());

  it('rejects guests and forged access tokens', async () => {
    await request(app.getHttpServer())
      .get('/v1/payments/subscriptions/current')
      .expect(401);
    await request(app.getHttpServer())
      .get('/v1/payments/subscriptions/current')
      .set('Authorization', 'Bearer forged')
      .expect(401);
    expect(subscriptions.current).not.toHaveBeenCalled();
  });

  it('binds purchase and cancellation to verified claims despite a forged account header', async () => {
    const requestId = randomUUID();
    await request(app.getHttpServer())
      .post('/v1/payments/subscriptions/checkout')
      .set('Authorization', `Bearer ${token}`)
      .set('x-user-id', bob)
      .send({
        requestId,
        tier: 'gold',
        method: 'aba_pay',
        userId: bob,
        amount: 0,
        quote: 'signed-price',
      })
      .expect(201);
    expect(subscriptions.purchase).toHaveBeenCalledWith(
      alice,
      'gold',
      requestId,
      'aba_pay',
      'signed-price',
    );
    await request(app.getHttpServer())
      .post('/v1/payments/subscriptions/cancel')
      .set('Authorization', `Bearer ${token}`)
      .set('x-user-id', bob)
      .send({ userId: bob })
      .expect(201);
    expect(subscriptions.cancel).toHaveBeenCalledWith(alice);
  });

  it('binds a validated quote to the authenticated account', async () => {
    await request(app.getHttpServer())
      .get('/v1/payments/subscriptions/quote/gold')
      .expect(401);
    await request(app.getHttpServer())
      .get('/v1/payments/subscriptions/quote/invalid')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    await request(app.getHttpServer())
      .get('/v1/payments/subscriptions/quote/diamond')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(subscriptions.quote).toHaveBeenCalledWith(
      alice,
      'diamond',
      undefined,
    );
  });

  it('validates plan, payment method and idempotency reference before purchase', async () => {
    for (const body of [
      { tier: 'free', method: 'aba_pay', requestId: randomUUID() },
      { tier: 'gold', method: 'cash', requestId: randomUUID() },
      { tier: 'gold', method: 'aba_pay', requestId: 'invalid' },
    ]) {
      await request(app.getHttpServer())
        .post('/v1/payments/subscriptions/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(400);
    }
    expect(subscriptions.purchase).not.toHaveBeenCalled();
  });

  it('allows only the property service to query internal entitlements', async () => {
    const path = `/internal/subscriptions/${alice}/allowance`;
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${signServiceToken('chat')}`)
      .expect(401);
    subscriptions.allowance.mockResolvedValue({
      listingLimit: 1,
      expiresAt: null,
    });
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${signServiceToken('property')}`)
      .expect(200);
    expect(subscriptions.allowance).toHaveBeenCalledWith(alice);
  });

  it('keeps the expired-subscription popup tied to the authenticated user', async () => {
    subscriptions.expired.mockResolvedValue({ tier: 'gold' });
    await request(app.getHttpServer())
      .get('/v1/payments/subscriptions/expired')
      .expect(401);
    await request(app.getHttpServer())
      .get('/v1/payments/subscriptions/expired')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { subscription: { tier: 'gold' } });
    expect(subscriptions.expired).toHaveBeenCalledWith(alice);
  });

  it('protects paid-listing entitlements with the property service guard', async () => {
    const path = `/internal/subscriptions/${alice}/publishing`;
    for (const bearer of [undefined, token, signServiceToken('chat')]) {
      const req = request(app.getHttpServer()).get(path);
      if (bearer) req.set('Authorization', `Bearer ${bearer}`);
      await req.expect(401);
    }
    subscriptions.publishingEntitlements.mockResolvedValue({
      listingLimit: 1,
      expiresAt: null,
      protectedPropertyIds: [],
      expiredPropertyIds: [],
    });
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${signServiceToken('property')}`)
      .expect(200);
    expect(subscriptions.publishingEntitlements).toHaveBeenCalledWith(alice);
  });
});
