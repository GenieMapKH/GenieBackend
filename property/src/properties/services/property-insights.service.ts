import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';

/** Days in the owner's chart, today included. */
export const INSIGHT_DAYS = 14;

/** Days are counted as the owners live them. */
const TIME_ZONE = 'Asia/Phnom_Penh';

/** Everything that happened to a listing, as its owner sees it. */
export interface InsightTotals {
  /** People who opened it (each once). */
  views: number;
  /** People who have it saved now. */
  saves: number;
  /** People who tapped Call. */
  calls: number;
  /** People who tapped Chat. */
  chats: number;
}

/** What happened on one day: new viewers, new saves, new leads. */
export interface InsightDay {
  /** `YYYY-MM-DD`, in Cambodia. */
  date: string;
  views: number;
  saves: number;
  leads: number;
}

export interface PropertyInsights {
  totals: InsightTotals;
  /** The last [INSIGHT_DAYS] days, oldest first, today last; a quiet day is zeros. */
  days: InsightDay[];
}

/**
 * How a listing is doing, for its owner only. Each person counts once per
 * kind: a view is the first time someone opened it, a save one still saved,
 * a lead the first Call or Chat tap.
 */
@Injectable()
export class PropertyInsightsService {
  constructor(private readonly prisma: PrismaService) {}

  async of(userId: string, propertyId: string): Promise<PropertyInsights> {
    const owned = await this.prisma.property.findFirst({
      where: { id: propertyId, userId, status: { not: 'Deleted' } },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Property not found');

    const [totals, days] = await Promise.all([
      this.totals(propertyId),
      this.days(propertyId),
    ]);
    return { totals, days };
  }

  private async totals(propertyId: string): Promise<InsightTotals> {
    const [row] = await this.prisma.$queryRaw<InsightTotals[]>`
      SELECT
        (SELECT count(*)::int FROM listing.property_views WHERE property_id = ${propertyId}::uuid) AS views,
        (SELECT count(*)::int FROM listing.property_favorites WHERE property_id = ${propertyId}::uuid) AS saves,
        (SELECT count(*)::int FROM listing.property_leads WHERE property_id = ${propertyId}::uuid AND channel = 'call') AS calls,
        (SELECT count(*)::int FROM listing.property_leads WHERE property_id = ${propertyId}::uuid AND channel = 'chat') AS chats`;
    return row;
  }

  /**
   * Each table is read once from the start of the first day (by its
   * `(property_id, created_at)` index) and grouped by local day.
   */
  private days(propertyId: string): Promise<InsightDay[]> {
    const zone = TIME_ZONE;
    const lastOffset = INSIGHT_DAYS - 1;
    return this.prisma.$queryRaw<InsightDay[]>`
      WITH since AS (
        SELECT first_day, (first_day::timestamp AT TIME ZONE ${zone}::text) AS at
        FROM (
          SELECT (now() AT TIME ZONE ${zone}::text)::date - ${lastOffset}::int AS first_day
        ) AS bounds
      ),
      views AS (
        SELECT (created_at AT TIME ZONE ${zone}::text)::date AS day, count(*)::int AS n
        FROM listing.property_views, since
        WHERE property_id = ${propertyId}::uuid AND created_at >= since.at
        GROUP BY 1
      ),
      saves AS (
        SELECT (created_at AT TIME ZONE ${zone}::text)::date AS day, count(*)::int AS n
        FROM listing.property_favorites, since
        WHERE property_id = ${propertyId}::uuid AND created_at >= since.at
        GROUP BY 1
      ),
      leads AS (
        SELECT (created_at AT TIME ZONE ${zone}::text)::date AS day, count(*)::int AS n
        FROM listing.property_leads, since
        WHERE property_id = ${propertyId}::uuid AND created_at >= since.at
        GROUP BY 1
      ),
      days AS (
        SELECT since.first_day + g.n AS day
        FROM since, generate_series(0, ${lastOffset}::int) AS g(n)
      )
      SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
        COALESCE(v.n, 0) AS views,
        COALESCE(s.n, 0) AS saves,
        COALESCE(l.n, 0) AS leads
      FROM days d
      LEFT JOIN views v ON v.day = d.day
      LEFT JOIN saves s ON s.day = d.day
      LEFT JOIN leads l ON l.day = d.day
      ORDER BY d.day`;
  }
}
