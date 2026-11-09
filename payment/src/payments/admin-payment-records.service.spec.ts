import { BadRequestException } from '@nestjs/common';
import { AdminPaymentRecordsService } from './admin-payment-records.service';

describe('admin payment records', () => {
  const prisma = {
    subscription: { findMany: jest.fn() },
    paymentTransaction: { findMany: jest.fn() },
  };
  const service = new AdminPaymentRecordsService(prisma as never);
  beforeEach(() => jest.resetAllMocks());

  it.each(['SUBSCRIPTION', 'LISTING_PUBLISH'])(
    'filters %s payments before pagination',
    async (purpose) => {
      prisma.paymentTransaction.findMany.mockResolvedValue([]);
      await service.list('successful-payments', 50, undefined, 'gold', purpose);
      expect(prisma.paymentTransaction.findMany.mock.calls[0][0]).toMatchObject(
        {
          where: { status: 'Success', currency: 'USD', purpose },
          skip: 50,
          take: 51,
        },
      );
      await expect(
        service.list(
          'successful-payments',
          0,
          undefined,
          undefined,
          'anything',
        ),
      ).rejects.toThrow(BadRequestException);
    },
  );

  it('searches tiers and transactions while preserving scope and pagination', async () => {
    prisma.subscription.findMany.mockResolvedValue([]);
    prisma.paymentTransaction.findMany.mockResolvedValue([]);
    await service.list('subscriptions', 50, 'gold', ' Gold ');
    expect(prisma.subscription.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        tier: 'gold',
        currentPeriodEnd: { gt: expect.any(Date) },
        OR: [{ tier: { contains: 'Gold', mode: 'insensitive' } }],
      },
      skip: 50,
    });
    await service.list('pending-payments', 0, undefined, 'publish');
    expect(
      prisma.paymentTransaction.findMany.mock.calls[0][0].where,
    ).toMatchObject({
      status: 'Pending',
      OR: expect.arrayContaining([
        { purpose: { contains: 'publish', mode: 'insensitive' } },
      ]),
    });
    const id = 'abcdef01-1234-1234-1234-123456789abc';
    await service.list('successful-payments', 0, undefined, id);
    expect(
      prisma.paymentTransaction.findMany.mock.calls[1][0].where,
    ).toMatchObject({
      status: 'Success',
      paidAt: { gte: expect.any(Date), lte: expect.any(Date) },
      OR: expect.arrayContaining([{ id }]),
    });
    await expect(
      service.list('subscriptions', 0, undefined, 'x'.repeat(101)),
    ).rejects.toThrow(BadRequestException);
  });

  it('lists current subscriptions in the selected tier and reads a bounded page', async () => {
    prisma.subscription.findMany.mockResolvedValue([]);
    expect(await service.list('subscriptions', 0, 'gold')).toEqual({
      items: [],
      nextOffset: null,
    });
    expect(prisma.subscription.findMany.mock.calls[0][0]).toMatchObject({
      where: { tier: 'gold', currentPeriodEnd: { gt: expect.any(Date) } },
      take: 51,
    });
  });

  it('keeps successful volume details in the same seven-day paid window and excludes pending payments', async () => {
    prisma.paymentTransaction.findMany.mockResolvedValue(
      Array.from({ length: 51 }, (_, id) => ({ id })),
    );
    const page = await service.list('successful-payments', 0);
    expect(page.items).toHaveLength(50);
    expect(page.nextOffset).toBe(50);
    const query = prisma.paymentTransaction.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({
      status: 'Success',
      paidAt: { gte: expect.any(Date), lte: expect.any(Date) },
    });
    expect(query.select).toMatchObject({
      amount: true,
      currency: true,
      provider: true,
      paidAt: true,
    });
    expect(query.select).not.toHaveProperty('externalId');
    await service.list('pending-payments', 0);
    expect(
      prisma.paymentTransaction.findMany.mock.calls[1][0].where,
    ).toMatchObject({
      status: 'Pending',
    });
  });

  it('rejects untrusted page and tier values', async () => {
    await expect(service.list('subscriptions', -1)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.list('subscriptions', 0, '__proto__')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.list('subscriptions', 0, 'free')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.list('users', 0)).rejects.toThrow(BadRequestException);
    expect(prisma.subscription.findMany).not.toHaveBeenCalled();
  });
});
