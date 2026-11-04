import { Injectable } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';

/**
 * How many people saved, opened and contacted a listing. `contacts` is the
 * people who called or opened a chat from it (`property_leads`), plus any
 * message sent through the contact form.
 */
export interface EngagementCount {
  favorites: number;
  views: number;
  contacts: number;
}

/** A listing nobody has engaged with yet, such as one just created. */
export const NO_ENGAGEMENT: EngagementCount = Object.freeze({
  favorites: 0,
  views: 0,
  contacts: 0,
});

/** A listing as the API sends it: its fields plus `_count`. */
export type WithEngagement<T> = T & { _count: EngagementCount };

/**
 * The `_count` every listing is sent with. Counted only for the listings
 * asked about, through the `property_id` indexes. (Prisma's own `_count`
 * groups the whole favorites, views and contacts tables on every read, so
 * its cost grows with all engagement on every listing, not with the rows
 * returned.)
 */
@Injectable()
export class PropertyEngagementCounts {
  constructor(private readonly prisma: PrismaService) {}

  /** The counts of each of `ids`; a listing with none is still present. */
  async of(ids: string[]): Promise<Map<string, EngagementCount>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();

    const rows = await this.prisma.$queryRaw<
      (EngagementCount & { id: string })[]
    >`
      SELECT p.id::text AS id,
        (SELECT count(*)::int FROM listing.property_favorites f WHERE f.property_id = p.id) AS favorites,
        (SELECT count(*)::int FROM listing.property_views v WHERE v.property_id = p.id) AS views,
        (SELECT count(DISTINCT l.user_id)::int FROM listing.property_leads l WHERE l.property_id = p.id)
          + (SELECT count(*)::int FROM listing.property_contacts c WHERE c.property_id = p.id) AS contacts
      FROM unnest(${unique}::uuid[]) AS p(id)`;
    return new Map(
      rows.map(({ id, favorites, views, contacts }) => [
        id,
        { favorites, views, contacts },
      ]),
    );
  }

  /** `rows`, each with its `_count`. */
  async attach<T extends { id: string }>(
    rows: T[],
  ): Promise<WithEngagement<T>[]> {
    const counts = await this.of(rows.map((row) => row.id));
    return rows.map((row) => withEngagement(row, counts));
  }
}

/** `row` with its `_count` from `counts` (all zero when missing). */
export function withEngagement<T extends { id: string }>(
  row: T,
  counts: Map<string, EngagementCount>,
): WithEngagement<T> {
  return { ...row, _count: counts.get(row.id) ?? NO_ENGAGEMENT };
}
