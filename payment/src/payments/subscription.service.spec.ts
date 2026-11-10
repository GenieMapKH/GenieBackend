import { ConflictException, NotImplementedException } from '@nestjs/common';
import { listingExpiry, monthAfter, PLANS } from './plan-catalog';
import { SubscriptionService } from './subscription.service';

describe('subscription periods', () => {
  it('expires listings in exactly 30 days across short months', () => {
    expect(listingExpiry(new Date('2026-02-01T12:34:00Z')).toISOString()).toBe('2026-03-03T12:34:00.000Z');
    expect(monthAfter(new Date('2028-02-29T12:34:00Z'), 12).toISOString()).toBe('2029-02-28T12:34:00.000Z');
  });
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
  const now = new Date('2026-11-16T00:00:00.000Z');
  const active = {
    userId: 'alice',
    tier: 'gold',
    transactionId: 'original',
    currentPeriodStart: new Date('2026-11-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-12-01T00:00:00.000Z'),
    cancelAtPeriodEnd: false,
    cancelledAt: null,
  };
  const tx = {
    $executeRaw: jest.fn(),
    paymentTransaction: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    subscription: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const prisma = { ...tx, $transaction: jest.fn((run) => run(tx)) };
  const gateway = {
    checkout: jest.fn(async (t) => ({ transactionId: t.id, status: t.status })),
  };
  const provider = { name: 'MOCK' };
  const service = new SubscriptionService(
    prisma as never,
    gateway as never,
    provider as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(now);
    process.env.PAYMENT_MODE = 'mock';
    process.env.INTERNAL_SERVICE_SECRET =
      'subscription-pricing-test-secret-32-characters';
    tx.subscription.findUnique.mockResolvedValue(null);
    tx.paymentTransaction.findUnique.mockResolvedValue(null);
    tx.paymentTransaction.findFirst.mockResolvedValue(null);
    tx.paymentTransaction.create.mockImplementation(async ({ data }) => ({
      id: 'tx-1',
      ...data,
    }));
  });
  afterEach(() => jest.useRealTimers());

  it.each(['silver', 'gold', 'diamond'] as const)('quotes twelve months for the price of ten for %s', async (tier) => {
    const quote = await service.quote('alice', tier, 'annual');
    expect(quote.amount).toBe(PLANS[tier].amount * 10);
    expect(quote.periodEnd).toBe('2027-11-16T00:00:00.000Z');
    await service.purchase('alice', tier, 'annual-request', 'aba_pay', quote.quote);
    expect(tx.paymentTransaction.create).toHaveBeenCalledWith({data: expect.objectContaining({billingPeriod: 'annual', amount: PLANS[tier].amount * 10})});
  });

  it('prorates annual upgrades and refuses a cycle switch during a paid period', async () => {
    tx.subscription.findUnique.mockResolvedValue({...active, billingPeriod: 'annual', currentPeriodStart: new Date('2026-05-17T12:00:00Z'), currentPeriodEnd: new Date('2027-05-17T12:00:00Z')});
    const quote = await service.quote('alice', 'diamond', 'annual');
    expect(quote.amount).toBe(70);
    await expect(service.quote('alice', 'diamond', 'monthly')).rejects.toThrow(ConflictException);
  });

  it('protects paid listings and in-flight remote fulfillment, without protecting failed payments', async () => {
    tx.paymentTransaction.findMany.mockResolvedValue([
      {
        propertyId: 'paid-listing',
        status: 'Success',
        listingPeriodEnd: new Date(now.getTime() + 1000),
      },
      {
        propertyId: 'pending-listing',
        status: 'Pending',
        listingPeriodEnd: null,
        createdAt: now,
      },
    ]);
    expect(await service.publishingEntitlements('alice')).toEqual({
      listingLimit: 1,
      expiresAt: null,
      protectedPropertyIds: ['paid-listing', 'pending-listing'],
      expiredPropertyIds: [],
    });
    expect(tx.paymentTransaction.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'alice',
        purpose: 'LISTING_PUBLISH',
        status: { in: ['Success', 'Pending'] },
        propertyId: { not: null },
      },
      select: {
        propertyId: true,
        status: true,
        listingPeriodEnd: true,
        createdAt: true,
      },
    });
  });

  it('expires one-time access at the exact boundary and ignores older expired purchases after renewal', async () => {
    tx.paymentTransaction.findMany.mockResolvedValue([
      { propertyId: 'expired', status: 'Success', listingPeriodEnd: now },
      {
        propertyId: 'stale-pending',
        status: 'Pending',
        listingPeriodEnd: null,
        createdAt: new Date('2026-10-16T00:00:00Z'),
      },
      { propertyId: 'renewed', status: 'Success', listingPeriodEnd: now },
      {
        propertyId: 'renewed',
        status: 'Success',
        listingPeriodEnd: new Date(now.getTime() + 1000),
      },
    ]);
    expect(await service.publishingEntitlements('alice')).toMatchObject({
      protectedPropertyIds: ['renewed'],
      expiredPropertyIds: ['expired', 'stale-pending'],
    });
  });

  it('only reads the signed-in account for the expired subscription popup', async () => {
    tx.subscription.findFirst.mockResolvedValue(null);
    expect(await service.expired('alice')).toBeNull();
    expect(tx.subscription.findFirst).toHaveBeenCalledWith({
      where: { userId: 'alice', currentPeriodEnd: { lte: now } },
    });
  });

  it.each(['silver', 'gold', 'diamond'] as const)(
    'quotes and records a full month for a new %s subscriber',
    async (tier) => {
      const price = { silver: 7, gold: 15, diamond: 29 }[tier];
      const quote = await service.quote('alice', tier);
      expect(quote).toMatchObject({
        amount: price,
        currency: 'USD',
        isUpgrade: false,
      });
      await service.purchase(
        'alice',
        tier,
        'request-1',
        'aba_pay',
        quote.quote,
      );
      expect(tx.paymentTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amount: price,
          status: 'Pending',
          subscriptionTier: tier,
        }),
      });
      expect(gateway.checkout).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tx-1', status: 'Pending' }),
      );
    },
  );

  it('charges only half of the Gold-to-Diamond difference halfway through the month', async () => {
    tx.subscription.findUnique.mockResolvedValue(active);
    const quote = await service.quote('alice', 'diamond');
    expect(quote.amount).toBe(7);
    expect(quote.periodEnd).toBe(active.currentPeriodEnd.toISOString());
    await service.purchase(
      'alice',
      'diamond',
      'request-1',
      'aba_pay',
      quote.quote,
    );
    expect(tx.paymentTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 7,
        subscriptionPeriodStart: active.currentPeriodStart,
        subscriptionPeriodEnd: active.currentPeriodEnd,
      }),
    });
  });

  it.each(['silver', 'gold'] as const)(
    'blocks active Gold from buying %s, including after cancellation',
    async (tier) => {
      tx.subscription.findUnique.mockResolvedValue({
        ...active,
        cancelAtPeriodEnd: true,
      });
      await expect(service.purchase('alice', tier, 'request')).rejects.toThrow(
        ConflictException,
      );
      expect(tx.paymentTransaction.create).not.toHaveBeenCalled();
    },
  );

  it('allows any plan after expiry', async () => {
    tx.subscription.findUnique.mockResolvedValue({
      ...active,
      currentPeriodEnd: now,
    });
    expect((await service.quote('alice', 'silver')).amount).toBe(7);
    expect(await service.current('alice')).toBeNull();
  });

  it('does not revoke existing benefits when checkout is disabled or the provider changes', async () => {
    tx.subscription.findUnique.mockResolvedValue(active);
    process.env.PAYMENT_MODE = 'disabled';
    expect(await service.current('alice')).toEqual(active);
    expect(await service.allowance('alice')).toEqual({
      listingLimit: 30,
      expiresAt: active.currentPeriodEnd,
    });
    await expect(
      service.purchase('alice', 'diamond', 'request'),
    ).rejects.toThrow(NotImplementedException);
  });

  it('returns an existing intent before checking expired quotes or eligibility', async () => {
    const original = {
      id: 'tx-1',
      purpose: 'SUBSCRIPTION',
      subscriptionTier: 'gold',
      status: 'Success',
    };
    tx.paymentTransaction.findUnique.mockResolvedValue(original);
    await service.purchase('alice', 'gold', 'request', 'aba_pay', 'expired');
    expect(gateway.checkout).toHaveBeenCalledWith(original);
    expect(tx.paymentTransaction.create).not.toHaveBeenCalled();
  });

  it('rejects reuse of an intent for a different tier', async () => {
    tx.paymentTransaction.findUnique.mockResolvedValue({
      purpose: 'SUBSCRIPTION',
      subscriptionTier: 'silver',
    });
    await expect(service.purchase('alice', 'gold', 'request')).rejects.toThrow(
      ConflictException,
    );
  });

  it('does not accept a forged quote, another account quote, or a stale subscription quote', async () => {
    const quote = await service.quote('alice', 'gold');
    await expect(
      service.purchase(
        'alice',
        'gold',
        'request',
        'aba_pay',
        quote.quote + 'x',
      ),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.purchase('bob', 'gold', 'request', 'aba_pay', quote.quote),
    ).rejects.toThrow(ConflictException);
    tx.subscription.findUnique.mockResolvedValue(active);
    await expect(
      service.purchase('alice', 'gold', 'request', 'aba_pay', quote.quote),
    ).rejects.toThrow(ConflictException);
    expect(tx.paymentTransaction.create).not.toHaveBeenCalled();
  });

  it('expires a quote without charging a revised amount silently', async () => {
    const quote = await service.quote('alice', 'gold');
    jest.advanceTimersByTime(301_000);
    await expect(
      service.purchase('alice', 'gold', 'request', 'aba_pay', quote.quote),
    ).rejects.toThrow(ConflictException);
    expect(gateway.checkout).not.toHaveBeenCalled();
  });

  it('blocks a second subscription payment while one is pending', async () => {
    tx.paymentTransaction.findFirst.mockResolvedValue({ id: 'pending' });
    await expect(service.purchase('alice', 'gold', 'request')).rejects.toThrow(
      ConflictException,
    );
    expect(tx.paymentTransaction.create).not.toHaveBeenCalled();
  });

  it('does not call the provider if saving the purchase fails', async () => {
    tx.paymentTransaction.create.mockRejectedValueOnce(new Error('db down'));
    await expect(service.purchase('alice', 'gold', 'request')).rejects.toThrow(
      'db down',
    );
    expect(gateway.checkout).not.toHaveBeenCalled();
  });

  it('cancellation preserves the paid tier and dates', async () => {
    tx.subscription.findUnique.mockResolvedValue(active);
    await service.cancel('alice');
    expect(tx.subscription.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'alice',
        currentPeriodEnd: { gt: now },
        cancelAtPeriodEnd: false,
      },
      data: { cancelAtPeriodEnd: true, cancelledAt: now },
    });
    expect(await service.current('alice')).toEqual(active);
  });
});
