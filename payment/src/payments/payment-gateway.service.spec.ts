import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@tilomnov/prisma-client';
import { PaymentGatewayService } from './payment-gateway.service';
import { AbaPaywayProvider } from './aba-payway.provider';

describe('provider-independent payment settlement', () => {
  const table = {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
  };
  const subscription = { findUnique: jest.fn(), upsert: jest.fn() };
  const tx = {
    $executeRaw: jest.fn(),
    paymentTransaction: table,
    subscription,
  };
  const prisma = { ...tx, $transaction: jest.fn((run) => run(tx)) };
  const provider = {
    name: 'BANK',
    initiateCheckout: jest.fn(),
    checkTransaction: jest.fn(),
  };
  const property = { settle: jest.fn() };
  const email = { send: jest.fn() };
  const gateway = new PaymentGatewayService(
    prisma as never,
    provider as never,
    property as never,
    email as never,
  );
  const now = new Date('2026-11-16T00:00:00.000Z');
  const initial = {
    id: 'tx-1',
    userId: 'alice',
    status: 'Pending',
    purpose: 'SUBSCRIPTION',
    provider: 'BANK',
    amount: new Prisma.Decimal(8.9),
    currency: 'USD',
    paymentMethod: 'aba_pay',
    subscriptionTier: 'gold',
    propertyId: null,
    paidAt: null,
    subscriptionPeriodStart: now,
    subscriptionPeriodEnd: new Date('2026-12-16T00:00:00.000Z'),
  };
  let row = { ...initial };
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(now);
    row = { ...initial };
    table.findUnique.mockImplementation(async () => row);
    table.findUniqueOrThrow.mockImplementation(async () => row);
    table.update.mockImplementation(
      async ({ data }) => (row = { ...row, ...data }),
    );
    subscription.findUnique.mockResolvedValue(null);
    subscription.upsert.mockResolvedValue({});
    property.settle.mockResolvedValue(undefined);
    email.send.mockResolvedValue(undefined);
    provider.initiateCheckout.mockResolvedValue({
      checkoutUrl: 'https://bank.test/pay',
    });
    provider.checkTransaction.mockResolvedValue({
      state: 'PAID',
      transactionId: 'tx-1',
      amount: 8.9,
      currency: 'USD',
    });
  });
  afterEach(() => jest.useRealTimers());

  it('keeps the existing plan until the provider verifies payment', async () => {
    provider.checkTransaction.mockResolvedValue({ state: 'PENDING' });
    expect(await gateway.checkout(row as never)).toMatchObject({
      status: 'Pending',
      checkoutUrl: 'https://bank.test/pay',
    });
    expect(subscription.upsert).not.toHaveBeenCalled();
    expect(table.update).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it.each([{ userId: null }, { purpose: 'LISTING_PUBLISH', propertyId: null }])(
    'retains a late verified payment for a deleted target: %j',
    async (target) => {
      table.findUniqueOrThrow.mockResolvedValueOnce({ ...row, ...target });
      await expect(gateway.reconcile('tx-1')).resolves.toMatchObject({
        status: 'RefundRequired',
        paidAt: now,
        amount: 8.9,
      });
      expect(subscription.upsert).not.toHaveBeenCalled();
      expect(property.settle).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    },
  );

  it('records a failed payment for an erased account without granting benefits', async () => {
    table.findUniqueOrThrow.mockResolvedValueOnce({ ...row, userId: null });
    provider.checkTransaction.mockResolvedValue({
      state: 'FAILED',
      transactionId: 'tx-1',
      amount: 8.9,
      currency: 'USD',
    });
    await expect(gateway.reconcile('tx-1')).resolves.toMatchObject({
      status: 'Failed',
      paidAt: null,
    });
    expect(subscription.upsert).not.toHaveBeenCalled();
    expect(property.settle).not.toHaveBeenCalled();
  });

  it.each([
    { amount: 1 },
    { currency: 'KHR' },
    { transactionId: 'other' },
    { amount: NaN },
    { state: 'UNRECOGNIZED' },
  ])('refuses mismatched or invalid verification: %j', async (change) => {
    provider.checkTransaction.mockResolvedValue({
      state: 'PAID',
      transactionId: 'tx-1',
      amount: 8.9,
      currency: 'USD',
      ...change,
    });
    await expect(gateway.reconcile('tx-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(subscription.upsert).not.toHaveBeenCalled();
    expect(table.update).not.toHaveBeenCalled();
  });

  it('atomically grants a verified month once and emails its actual amount', async () => {
    expect(await gateway.reconcile('tx-1')).toMatchObject({
      status: 'Success',
      amount: 8.9,
      paidAt: now,
    });
    expect(subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          tier: 'gold',
          currentPeriodStart: now,
          currentPeriodEnd: initial.subscriptionPeriodEnd,
        }),
      }),
    );
    await gateway.reconcile('tx-1');
    expect(subscription.upsert).toHaveBeenCalledTimes(1);
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 8.9 }),
    );
  });

  it('does not regrant benefits when a concurrent settlement already committed', async () => {
    table.findUniqueOrThrow.mockResolvedValueOnce({
      ...row,
      status: 'Success',
    });
    expect(await gateway.reconcile('tx-1')).toMatchObject({
      status: 'Success',
    });
    expect(subscription.upsert).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('preserves the original billing dates and cancellation on a prorated upgrade', async () => {
    const active = {
      tier: 'gold',
      currentPeriodStart: new Date('2026-11-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-12-01T00:00:00.000Z'),
      cancelAtPeriodEnd: true,
      cancelledAt: now,
    };
    row = {
      ...row,
      subscriptionTier: 'diamond',
      amount: new Prisma.Decimal(4),
      subscriptionPeriodEnd: active.currentPeriodEnd,
    };
    provider.checkTransaction.mockResolvedValue({
      state: 'PAID',
      transactionId: 'tx-1',
      amount: 4,
      currency: 'USD',
    });
    subscription.findUnique.mockResolvedValue(active);
    await gateway.reconcile('tx-1');
    expect(subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ ...active, tier: 'diamond' }),
      }),
    );
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 4,
        periodEnd: active.currentPeriodEnd.toISOString(),
      }),
    );
  });

  it('starts a new full month when payment completes, rather than when quoted', async () => {
    jest.advanceTimersByTime(120_000);
    await gateway.reconcile('tx-1');
    expect(subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          currentPeriodStart: new Date(now.getTime() + 120_000),
          currentPeriodEnd: new Date('2026-12-16T00:02:00.000Z'),
        }),
      }),
    );
  });

  it.each([0, 60_000])(
    'records a refund requirement when an upgrade is confirmed at or after expiry (+%s ms)',
    async (delay) => {
      const end = new Date(now.getTime() - delay);
      row = {
        ...row,
        subscriptionTier: 'diamond',
        amount: new Prisma.Decimal(0.01),
        subscriptionPeriodEnd: end,
      };
      subscription.findUnique.mockResolvedValue({
        tier: 'gold',
        currentPeriodStart: new Date('2026-10-16T00:00:00Z'),
        currentPeriodEnd: end,
      });
      provider.checkTransaction.mockResolvedValue({
        state: 'PAID',
        transactionId: row.id,
        amount: 0.01,
        currency: 'USD',
      });
      expect(await gateway.reconcile(row.id)).toMatchObject({
        status: 'RefundRequired',
        paidAt: now,
      });
      await gateway.reconcile(row.id);
      expect(subscription.upsert).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
      expect(table.update).toHaveBeenCalledTimes(1);
    },
  );

  it('does not grant or email a failed payment', async () => {
    provider.checkTransaction.mockResolvedValue({
      state: 'FAILED',
      transactionId: 'tx-1',
      amount: 8.9,
      currency: 'USD',
    });
    expect(await gateway.reconcile('tx-1')).toMatchObject({
      status: 'Failed',
      paidAt: null,
    });
    expect(subscription.upsert).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('publishes a verified listing and releases a failed listing', async () => {
    row = {
      ...row,
      purpose: 'LISTING_PUBLISH',
      propertyId: 'property-1' as never,
    };
    await gateway.reconcile('tx-1');
    expect(property.settle).toHaveBeenCalledWith('property-1', 'Active');
    expect(table.update).toHaveBeenCalledWith({
      where: { id: 'tx-1' },
      data: expect.objectContaining({
        listingPeriodEnd: new Date('2026-12-16T00:00:00Z'),
      }),
    });
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ item: 'listing_publish', amount: 8.9 }),
    );
    row = { ...row, status: 'Pending' };
    provider.checkTransaction.mockResolvedValue({
      state: 'FAILED',
      transactionId: 'tx-1',
      amount: 8.9,
      currency: 'USD',
    });
    await gateway.reconcile('tx-1');
    expect(property.settle).toHaveBeenLastCalledWith('property-1', 'Draft');
  });

  it('keeps payment pending and sends no email when fulfillment fails', async () => {
    subscription.upsert.mockRejectedValueOnce(new Error('database down'));
    await expect(gateway.reconcile('tx-1')).rejects.toThrow('database down');
    expect(table.update).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
    expect(row.status).toBe('Pending');
    await gateway.reconcile('tx-1');
    expect(row.status).toBe('Success');
  });

  it('sends no email when the final database commit fails', async () => {
    prisma.$transaction.mockImplementationOnce(async (run) => {
      await run(tx);
      throw new Error('commit failed');
    });
    await expect(gateway.reconcile('tx-1')).rejects.toThrow('commit failed');
    expect(email.send).not.toHaveBeenCalled();
  });

  it('does not mark a listing paid if the property service fails', async () => {
    row = {
      ...row,
      purpose: 'LISTING_PUBLISH',
      propertyId: 'property-1' as never,
    };
    property.settle.mockRejectedValueOnce(new Error('property down'));
    await expect(gateway.reconcile('tx-1')).rejects.toThrow('property down');
    expect(table.update).not.toHaveBeenCalled();
  });

  it('keeps live payments unavailable until the real bank adapter is implemented', async () => {
    const bank = new AbaPaywayProvider();
    expect(
      bank.verifyWebhook(
        { transactionId: 'tx-1', status: 'SUCCESS' },
        'anything',
      ),
    ).toBe(false);
    expect(() =>
      bank.initiateCheckout({
        transactionId: 'tx-1',
        amount: 8.9,
        currency: 'USD',
        method: 'aba_pay',
      }),
    ).toThrow();
    expect(() =>
      bank.checkTransaction({
        transactionId: 'tx-1',
        amount: 8.9,
        currency: 'USD',
        method: 'aba_pay',
      }),
    ).toThrow();
  });
});
