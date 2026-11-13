import { AdminIncomeService } from './admin-income.service';
import { InternalAdminDashboardController } from './internal-admin-dashboard.controller';
import { GUARDS_METADATA } from '@nestjs/common/constants';

describe('admin income', () => {
  const prisma = { $queryRaw: jest.fn() };
  const service = new AdminIncomeService(prisma as never);
  const now = new Date('2026-11-09T18:00:00Z');
  beforeEach(() => jest.resetAllMocks());

  it('sums settled USD by business purpose, fills empty dates and respects Cambodia midnight', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        date: '2026-11-04',
        subscriptionUsd: '8.90',
        listingUsd: '2.00',
        count: 3,
      },
      {
        date: '2026-11-10',
        subscriptionUsd: '5.90',
        listingUsd: '1.00',
        count: 2,
      },
    ]);
    const result = await service.summary(now);
    expect(result).toMatchObject({
      successfulTransactions7d: 5,
      volumeUsd7d: 17.8,
      income: {
        timeZone: 'Asia/Phnom_Penh',
        subscriptionUsd: 14.8,
        listingUsd: 3,
      },
    });
    expect(result.income.days).toHaveLength(8);
    expect(result.income.days[0]).toEqual({
      date: '2026-11-03',
      subscriptionUsd: 0,
      listingUsd: 0,
    });
    expect(result.income.days[1]).toEqual({
      date: '2026-11-04',
      subscriptionUsd: 8.9,
      listingUsd: 2,
    });
    expect(result.income.days[7]).toEqual({
      date: '2026-11-10',
      subscriptionUsd: 5.9,
      listingUsd: 1,
    });
    expect(prisma.$queryRaw.mock.calls[0][0].join('?')).toContain(
      "provider <> 'MOCK'",
    );
    const [sql, since, end] = prisma.$queryRaw.mock.calls[0];
    expect(sql.join('?')).toContain("status = 'Success' AND currency = 'USD'");
    expect(sql.join('?')).toContain(
      "purpose IN ('SUBSCRIPTION', 'LISTING_PUBLISH')",
    );
    expect(sql.join('?')).toContain('paid_at >= ? AND paid_at <= ?');
    expect(since.toISOString()).toBe('2026-11-02T18:00:00.000Z');
    expect(end).toEqual(now);
  });

  it('returns a zero-filled chart when no payments settled', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    const result = await service.summary(new Date('2026-11-09T16:59:59Z'));
    expect(result.volumeUsd7d).toBe(0);
    expect(result.successfulTransactions7d).toBe(0);
    expect(
      result.income.days.every(
        (day) => day.subscriptionUsd === 0 && day.listingUsd === 0,
      ),
    ).toBe(true);
    expect(result.income.days[result.income.days.length - 1].date).toBe(
      '2026-11-09',
    );
  });

  it('does not hide a database failure behind a zero-income chart', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('Database unavailable'));
    await expect(service.summary(now)).rejects.toThrow('Database unavailable');
  });

  it('requires the internal service guard for income and payment records', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, InternalAdminDashboardController),
    ).toHaveLength(1);
  });
});
