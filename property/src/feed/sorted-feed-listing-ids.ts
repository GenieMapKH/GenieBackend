import { Prisma } from '@tilomnov/prisma-client';
import { PrismaService } from '@tilomnov/shared';
import { FeedCursor } from './feed-cursor';
import { FEED_PRICE, FeedFilters, feedConditions } from './feed-filters';
import { FeedPosition } from './feed-listing-ids';

/** Numeric sorts use their value, publication time and id as a stable page boundary. */
export function sortedFeedPositions(
  prisma: PrismaService,
  ownerIds: string[],
  take: number,
  filters: FeedFilters,
  after?: FeedCursor,
): Promise<FeedPosition[]> {
  const rank =
    filters.sort === 'top'
      ? Prisma.sql`(SELECT count(*) FROM listing.property_favorites f WHERE f.property_id = p.id)`
      : filters.sort === 'priceLow'
        ? Prisma.sql`-(${FEED_PRICE})`
        : FEED_PRICE;
  const cursor = after
    ? Prisma.sql`WHERE sort_value < ${after.sortValue}::numeric
        OR (sort_value = ${after.sortValue}::numeric AND feed_at < ${after.feedAt})
        OR (sort_value = ${after.sortValue}::numeric AND feed_at = ${after.feedAt} AND id > ${after.id}::uuid)`
    : Prisma.empty;

  return prisma.$queryRaw<FeedPosition[]>`
    WITH ranked AS (
      SELECT p.id, date_trunc('milliseconds', p.published_at) AS feed_at,
        ${rank} AS sort_value
      FROM listing.properties p
      JOIN account.users u ON u.id = p.user_id AND u.deactivated_at IS NULL
      WHERE p.user_id = ANY(${ownerIds}::uuid[])
        AND p.status = 'Active' AND p.published_at IS NOT NULL
        ${feedConditions(filters)}
    )
    SELECT id::text AS id, feed_at AS "feedAt", sort_value::text AS "sortValue"
    FROM ranked ${cursor}
    ORDER BY sort_value DESC, feed_at DESC, id ASC
    LIMIT ${take}`;
}
