import { ConflictException, NotImplementedException } from '@nestjs/common';
import { monthAfter } from './plan-catalog';
import { SubscriptionService } from './subscription.service';

describe('subscription periods', () => {
  it.each([
    ['2026-11-06T14:23:45.678Z', '2026-12-06T14:23:45.678Z'],
    ['2026-01-31T14:23:45.678Z', '2026-02-28T14:23:45.678Z'],
    ['2028-01-31T14:23:45.678Z', '2028-02-29T14:23:45.678Z'],
    ['2026-12-31T14:23:45.678Z', '2027-01-31T14:23:45.678Z'],
  ])('one month after %s is %s', (start, expected) => {
    expect(monthAfter(new Date(start)).toISOString()).toBe(expected);
  });
});

describe('SubscriptionService', () => {
  const tx = {
    $executeRaw: jest.fn(),
    paymentTransaction: { findUnique: jest.fn(), create: jest.fn() },
    subscription: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const prisma = { ...tx, $transaction: jest.fn((run) => run(tx)) };
  const service = new SubscriptionService(prisma as never);
  const now = new Date('2026-11-06T14:23:45.678Z');
  const current = {
    userId: 'alice',
    tier: 'gold',
    currentPeriodStart: now,
    currentPeriodEnd: monthAfter(now),
    cancelAtPeriodEnd: false,
    transaction: { provider: 'MOCK' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(now);
    process.env.APP_ENV = 'test';
    process.env.PAYMENT_MODE = 'mock';
    tx.paymentTransaction.findUnique.mockResolvedValue(null);
    tx.subscription.findUnique.mockResolvedValue(null);
    tx.paymentTransaction.create.mockResolvedValue({
      id: 'tx-1',
      status: 'Success',
    });
  });
  afterEach(() => jest.useRealTimers());

  it('persists the account, server price and exact period atomically', async () => {
    await expect(
      service.purchase('alice', 'gold', 'request-1'),
    ).resolves.toMatchObject({
      transactionId: 'tx-1',
      status: 'Success',
      isSimulation: true,
    });
    expect(tx.paymentTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'alice',
        amount: 8.9,
        currency: 'USD',
        provider: 'MOCK',
        paidAt: now,
      }),
    });
    expect(tx.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'alice' },
        create: expect.objectContaining({
          userId: 'alice',
          tier: 'gold',
          currentPeriodStart: now,
          currentPeriodEnd: monthAfter(now),
          transactionId: 'tx-1',
        }),
      }),
    );
    expect(tx.$executeRaw).toHaveBeenCalled();
  });

  it('a retry returns the same transaction without extending the paid period', async () => {
    tx.paymentTransaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      purpose: 'SUBSCRIPTION',
      subscriptionTier: 'gold',
      status: 'Success',
    });
    await service.purchase('alice', 'gold', 'request-1');
    expect(tx.subscription.upsert).not.toHaveBeenCalled();
    expect(tx.paymentTransaction.create).not.toHaveBeenCalled();
  });

  it('rejects reuse of a checkout reference for a different plan', async () => {
    tx.paymentTransaction.findUnique.mockResolvedValue({
      purpose: 'SUBSCRIPTION',
      subscriptionTier: 'silver',
    });
    await expect(
      service.purchase('alice', 'gold', 'request-1'),
    ).rejects.toThrow(ConflictException);
  });

  it.each(['silver', 'gold', 'diamond'] as const)(
    'can simulate buying %s while Gold is active',
    async (tier) => {
      tx.subscription.findUnique.mockResolvedValue(current);
      await expect(
        service.purchase('alice', tier, 'request-1'),
      ).resolves.toMatchObject({ status: 'Success', isSimulation: true });
      expect(tx.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ tier }),
        }),
      );
    },
  );

  it('cancellation changes only renewal and preserves paid benefits', async () => {
    tx.subscription.findUnique.mockResolvedValue({
      ...current,
      cancelAtPeriodEnd: true,
    });
    await service.cancel('alice');
    expect(tx.subscription.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'alice',
        currentPeriodEnd: { gt: now },
        cancelAtPeriodEnd: false,
      },
      data: { cancelAtPeriodEnd: true, cancelledAt: now },
    });
    expect(await service.allowance('alice')).toEqual({
      listingLimit: 50,
      expiresAt: current.currentPeriodEnd,
    });
  });

  it('expires at the precise timestamp, even without a scheduled job', async () => {
    tx.subscription.findUnique.mockResolvedValue({
      ...current,
      currentPeriodEnd: now,
    });
    expect(await service.current('alice')).toBeNull();
    expect(await service.allowance('alice')).toEqual({
      listingLimit: 1,
      expiresAt: null,
    });
  });

  it('supports persisted simulated subscriptions in production builds', async () => {
    process.env.APP_ENV = 'production';
    delete process.env.PAYMENT_MODE;
    tx.subscription.findUnique.mockResolvedValue(current);
    expect(await service.current('alice')).toMatchObject({ tier: 'gold' });
    await expect(
      service.purchase('alice', 'diamond', 'request-1'),
    ).resolves.toMatchObject({ status: 'Success', isSimulation: true });
  });

  it.each(['disabled', 'live', ''])(
    'cannot grant a mock plan in PAYMENT_MODE=%s',
    async (mode) => {
      process.env.PAYMENT_MODE = mode;
      tx.subscription.findUnique.mockResolvedValue(current);
      expect(await service.current('alice')).toBeNull();
      await expect(
        service.purchase('alice', 'diamond', 'request-1'),
      ).rejects.toThrow(NotImplementedException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
});
