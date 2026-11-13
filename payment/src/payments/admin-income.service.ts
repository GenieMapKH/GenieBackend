import { Injectable } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';

interface IncomeRow {
  date: string;
  subscriptionUsd: string;
  listingUsd: string;
  count: number;
}

@Injectable()
export class AdminIncomeService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(now = new Date()) {
    const since = new Date(now.getTime() - 7 * 86400000);
    const rows = await this.prisma.$queryRaw<IncomeRow[]>`
      SELECT to_char(paid_at AT TIME ZONE 'Asia/Phnom_Penh', 'YYYY-MM-DD') AS date,
        COALESCE(SUM(amount) FILTER (WHERE purpose = 'SUBSCRIPTION'), 0)::text AS "subscriptionUsd",
        COALESCE(SUM(amount) FILTER (WHERE purpose = 'LISTING_PUBLISH'), 0)::text AS "listingUsd",
        COUNT(*)::int AS count
      FROM payment.payment_transactions
      WHERE status = 'Success' AND currency = 'USD'
        AND provider <> 'MOCK'
        AND purpose IN ('SUBSCRIPTION', 'LISTING_PUBLISH')
        AND paid_at >= ${since} AND paid_at <= ${now}
      GROUP BY 1 ORDER BY 1
    `;
    const byDate = new Map(rows.map((row) => [row.date, row]));
    // Cambodia is UTC+7 without daylight saving; the rolling window has partial first/last dates.
    const localDate = (date: Date) =>
      new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10);
    const first = Date.parse(`${localDate(since)}T00:00:00Z`);
    const last = Date.parse(`${localDate(now)}T00:00:00Z`);
    const days: {
      date: string;
      subscriptionUsd: number;
      listingUsd: number;
    }[] = [];
    for (let day = first; day <= last; day += 86400000) {
      const date = new Date(day).toISOString().slice(0, 10);
      const row = byDate.get(date);
      days.push({
        date,
        subscriptionUsd: Number(row?.subscriptionUsd ?? 0),
        listingUsd: Number(row?.listingUsd ?? 0),
      });
    }
    const cents = (value: string) => Math.round(Number(value) * 100);
    const subscriptionCents = rows.reduce(
      (sum, row) => sum + cents(row.subscriptionUsd),
      0,
    );
    const listingCents = rows.reduce(
      (sum, row) => sum + cents(row.listingUsd),
      0,
    );
    return {
      successfulTransactions7d: rows.reduce((sum, row) => sum + row.count, 0),
      volumeUsd7d: (subscriptionCents + listingCents) / 100,
      income: {
        timeZone: 'Asia/Phnom_Penh',
        subscriptionUsd: subscriptionCents / 100,
        listingUsd: listingCents / 100,
        days,
      },
    };
  }
}
