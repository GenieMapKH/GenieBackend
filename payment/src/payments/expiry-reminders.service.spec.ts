import { ServiceClient } from '@tilomnov/shared';
import { ExpiryRemindersService } from './expiry-reminders.service';

describe('publishing expiry reminders', () => {
  const now = new Date('2026-11-10T00:00:00Z');
  const ends = new Date('2026-11-12T00:00:00Z');
  const subscription = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  };
  const paymentTransaction = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  };
  const tx = { subscription, paymentTransaction, $queryRaw: jest.fn() };
  const prisma = { ...tx, $transaction: jest.fn((run) => run(tx)) };
  const service = new ExpiryRemindersService(prisma as never);
  let call: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(now);
    prisma.$transaction.mockImplementation((run) => run(tx));
    tx.$queryRaw.mockResolvedValue([{ locked: true }]);
    subscription.findMany.mockResolvedValue([
      { userId: 'alice', tier: 'gold', currentPeriodEnd: ends },
    ]);
    paymentTransaction.findMany.mockResolvedValue([
      {
        id: 'listing-payment',
        userId: 'bob',
        propertyId: 'property',
        listingPeriodEnd: ends,
      },
    ]);
    subscription.findFirst.mockImplementation(async ({ where }) =>
      where.currentPeriodEnd instanceof Date ? { userId: 'alice' } : null,
    );
    paymentTransaction.findFirst.mockImplementation(async ({ where }) =>
      where.id ? { id: 'listing-payment' } : null,
    );
    call = jest
      .spyOn(ServiceClient.prototype, 'call')
      .mockResolvedValue({ sent: 1, failed: 0, removed: 0 });
  });
  afterEach(() => {
    call.mockRestore();
    jest.useRealTimers();
  });

  it('finds both kinds in the next three days and marks each delivered period once', async () => {
    await service.scan(now);
    expect(subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          currentPeriodEnd: { gt: now, lte: new Date('2026-11-13T00:00:00Z') },
          expiryReminderSentAt: null,
        },
      }),
    );
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenCalledWith(
      'POST',
      '/internal/notifications/publishing-expiry',
      expect.objectContaining({
        body: {
          userId: 'alice',
          kind: 'subscription',
          tier: 'gold',
          expiresAt: ends.toISOString(),
        },
      }),
    );
    expect(call).toHaveBeenCalledWith(
      'POST',
      '/internal/notifications/publishing-expiry',
      expect.objectContaining({
        body: {
          userId: 'bob',
          kind: 'listing',
          propertyId: 'property',
          expiresAt: ends.toISOString(),
        },
      }),
    );
    expect(subscription.update).toHaveBeenCalledWith({
      where: { userId: 'alice' },
      data: { expiryReminderSentAt: now },
    });
    expect(paymentTransaction.update).toHaveBeenCalledWith({
      where: { id: 'listing-payment' },
      data: { expiryReminderSentAt: now },
    });
  });

  it('does not duplicate another worker or send a stale subscription period', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ locked: false }]);
    paymentTransaction.findFirst.mockResolvedValue(null);
    await service.scan(now);
    expect(call).not.toHaveBeenCalled();
    expect(subscription.update).not.toHaveBeenCalled();
    expect(paymentTransaction.update).not.toHaveBeenCalled();
  });

  it('leaves undelivered reminders eligible for retry', async () => {
    call.mockRejectedValue(new Error('notification unavailable'));
    await service.scan(now);
    expect(subscription.update).not.toHaveBeenCalled();
    expect(paymentTransaction.update).not.toHaveBeenCalled();
    call.mockResolvedValue({ sent: 1, failed: 0, removed: 0 });
    await service.scan(now);
    expect(subscription.update).toHaveBeenCalledTimes(1);
    expect(paymentTransaction.update).toHaveBeenCalledTimes(1);
  });

  it('continues past a failed first batch so later users still receive reminders', async () => {
    const batch = Array.from({ length: 100 }, (_, index) => ({
      userId: `user-${index}`,
      tier: 'gold',
      currentPeriodEnd: ends,
    }));
    subscription.findMany
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce([
        { userId: 'last-user', tier: 'gold', currentPeriodEnd: ends },
      ]);
    paymentTransaction.findMany.mockResolvedValue([]);
    call.mockRejectedValueOnce(new Error('first user unavailable'));
    await service.scan(now);
    expect(call).toHaveBeenCalledTimes(101);
    expect(subscription.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: { gt: 'user-99' } }),
      }),
    );
    expect(subscription.update).toHaveBeenLastCalledWith({
      where: { userId: 'last-user' },
      data: { expiryReminderSentAt: now },
    });
  });

  it('does not mark transient device delivery failures as delivered', async () => {
    call.mockResolvedValue({ sent: 0, failed: 1, removed: 0 });
    await service.scan(now);
    expect(subscription.update).not.toHaveBeenCalled();
    expect(paymentTransaction.update).not.toHaveBeenCalled();
  });

  it('skips reminders for posts already covered by a longer subscription', async () => {
    subscription.findMany.mockResolvedValue([]);
    subscription.findFirst.mockResolvedValue({ tier: 'gold' });
    await service.scan(now);
    expect(call).not.toHaveBeenCalled();
    expect(paymentTransaction.update).toHaveBeenCalledTimes(1);
  });

  it('skips an older individual period after another payment renewed it', async () => {
    subscription.findMany.mockResolvedValue([]);
    paymentTransaction.findFirst.mockResolvedValue({ id: 'renewal' });
    await service.scan(now);
    expect(call).not.toHaveBeenCalled();
    expect(paymentTransaction.update).toHaveBeenCalledTimes(1);
  });
});
