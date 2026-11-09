import { BadRequestException } from '@nestjs/common';
import { AdminPaymentRecordsService } from './admin-payment-records.service';

describe('admin payment records', () => {
  const prisma = {
    subscription: { findMany: jest.fn() },
    paymentTransaction: { findMany: jest.fn() },
  };
  const service = new AdminPaymentRecordsService(prisma as never);
  beforeEach(() => jest.resetAllMocks());

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
    expect(query.where).toEqual({
      status: 'Success',
      paidAt: { gte: expect.any(Date) },
    });
    expect(query.select).toMatchObject({
      amount: true,
      currency: true,
      provider: true,
      paidAt: true,
    });
    expect(query.select).not.toHaveProperty('externalId');
    await service.list('pending-payments', 0);
    expect(prisma.paymentTransaction.findMany.mock.calls[1][0].where).toEqual({
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
