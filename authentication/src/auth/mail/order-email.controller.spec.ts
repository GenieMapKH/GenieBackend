import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService, signServiceToken } from '@tilomnov/shared';
import { enableApiVersioning } from '@tilomnov/shared/api-versions';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { EmailDeliveryService } from './email-delivery.service';
import { OrderEmailController } from './order-email.controller';

describe('subscription confirmation email', () => {
  let app: INestApplication;
  const prisma = { user: { findUnique: jest.fn() } };
  const delivery = { deliver: jest.fn() };
  const details = {
    userId: randomUUID(),
    transactionId: randomUUID(),
    item: 'gold',
    amount: 8.9,
    periodStart: '2026-11-08T00:00:00.000Z',
    periodEnd: '2026-12-08T00:00:00.000Z',
  };
  beforeAll(async () => {
    process.env.INTERNAL_SERVICE_SECRET =
      'subscription-email-test-secret-32-characters';
    const module = await Test.createTestingModule({
      controllers: [OrderEmailController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: EmailDeliveryService, useValue: delivery },
      ],
    }).compile();
    app = module.createNestApplication();
    enableApiVersioning(app);
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ email: 'saved@example.com' });
    delivery.deliver.mockResolvedValue(true);
  });
  afterAll(async () => app?.close());

  const send = (body: object = details) =>
    request(app.getHttpServer())
      .post('/internal/mail/order')
      .set('Authorization', `Bearer ${signServiceToken('payment')}`)
      .send(body);

  it('sends server purchase details to the saved account email', async () => {
    await send({ ...details, to: 'forged@example.com' }).expect(201);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: details.userId },
      select: { email: true },
    });
    expect(delivery.deliver).toHaveBeenCalledWith({
      to: 'saved@example.com',
      subject: expect.stringContaining(details.transactionId),
      html: expect.stringContaining('USD 8.90'),
    });
    expect(delivery.deliver.mock.calls[0][0].html).not.toMatch(
      /simulated|No money/i,
    );
  });

  it('skips accounts without email', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: null });
    await send().expect(201, { sent: false });
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it('sends one-time listing order confirmations through the same delivery service', async () => {
    await send({
      ...details,
      item: 'listing_publish',
      periodEnd: undefined,
      amount: 1,
    }).expect(201);
    expect(delivery.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'saved@example.com',
        html: expect.stringContaining('One-time listing publication'),
      }),
    );
  });

  it('reports provider failure to the payment service', async () => {
    delivery.deliver.mockResolvedValue(false);
    await send().expect(503);
  });

  it('rejects guests and other services', async () => {
    await request(app.getHttpServer())
      .post('/internal/mail/order')
      .send(details)
      .expect(401);
    await request(app.getHttpServer())
      .post('/internal/mail/order')
      .set('Authorization', `Bearer ${signServiceToken('property')}`)
      .send(details)
      .expect(401);
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it.each([
    { item: '<script>bad</script>' },
    { transactionId: 'bad' },
    { amount: -1 },
    { periodStart: '<b>bad</b>' },
    { userId: 'bad' },
  ])('rejects malformed purchase details: %j', async (invalid) => {
    await send({ ...details, ...invalid }).expect(400);
    expect(delivery.deliver).not.toHaveBeenCalled();
  });
});
