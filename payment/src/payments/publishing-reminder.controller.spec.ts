import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { signServiceToken } from '@tilomnov/shared';
import { enableApiVersioning } from '@tilomnov/shared/api-versions';
import * as request from 'supertest';
import { ExpiryRemindersService } from './expiry-reminders.service';
import { PublishingReminderController } from './publishing-reminder.controller';

describe('current queued reminder checks', () => {
  let app: INestApplication;
  const reminders = { isCurrent: jest.fn().mockResolvedValue(false) };
  const body = {
    userId: '11111111-1111-4111-8111-111111111111',
    kind: 'subscription',
    expiresAt: '2026-12-01T00:00:00Z',
  };
  const originalSecret = process.env.INTERNAL_SERVICE_SECRET;
  beforeAll(async () => {
    process.env.INTERNAL_SERVICE_SECRET =
      'reminder-check-local-test-secret-32-characters';
    const module = await Test.createTestingModule({
      controllers: [PublishingReminderController],
      providers: [{ provide: ExpiryRemindersService, useValue: reminders }],
    }).compile();
    app = module.createNestApplication();
    enableApiVersioning(app);
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    if (originalSecret === undefined)
      delete process.env.INTERNAL_SERVICE_SECRET;
    else process.env.INTERNAL_SERVICE_SECRET = originalSecret;
  });
  beforeEach(() => jest.clearAllMocks());
  it('lets only notification check whether an expiry period is still current', async () => {
    await request(app.getHttpServer())
      .post('/internal/publishing-reminders/current')
      .set('Authorization', `Bearer ${signServiceToken('notification')}`)
      .send(body)
      .expect(200, { current: false });
    expect(reminders.isCurrent).toHaveBeenCalledWith(body);
  });
  it('rejects guests and other backend service identities', async () => {
    await request(app.getHttpServer())
      .post('/internal/publishing-reminders/current')
      .send(body)
      .expect(401);
    await request(app.getHttpServer())
      .post('/internal/publishing-reminders/current')
      .set('Authorization', `Bearer ${signServiceToken('property')}`)
      .send(body)
      .expect(401);
    expect(reminders.isCurrent).not.toHaveBeenCalled();
  });
  it('validates reminder input before reading the ledger', async () => {
    await request(app.getHttpServer())
      .post('/internal/publishing-reminders/current')
      .set('Authorization', `Bearer ${signServiceToken('notification')}`)
      .send({ ...body, userId: 'invalid' })
      .expect(400);
    expect(reminders.isCurrent).not.toHaveBeenCalled();
  });
});
