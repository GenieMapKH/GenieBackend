import { Prisma } from '@tilomnov/prisma-client';
import { PrismaService } from '@tilomnov/shared';
import { FeedCursor } from './feed-cursor';

/** A listing's place in the feed: when it is ranked, not when it was published. */
export interface FeedPosition {
  id: string;
  feedAt: Date;
}

/**
 * The next `take` live listings of `ownerIds` after `after`, highest ranked
 * first, ties by id. Hidden (deactivated) owners are left out.
 *
 * A listing is ranked by its publication time, moved `spreadHours` older for
 * each newer live listing of the same owner. Within one owner that keeps the
 * newest-first order, so each owner's best `take` are the ones to merge: an
 * owner who published 20 listings at once is interleaved with the others
 * instead of taking 20 places in a row. Times are cut to milliseconds, which
 * is all the cursor can carry.
 */
export async function nextFeedPositions(
  prisma: PrismaService,
  ownerIds: string[],
  take: number,
  spreadHours: number,
  after?: FeedCursor,
): Promise<FeedPosition[]> {
  const afterCursor = after
    ? Prisma.sql`WHERE feed_at < ${after.feedAt}
         OR (feed_at = ${after.feedAt} AND id > ${after.id}::uuid)`
    : Prisma.empty;

  return prisma.$queryRaw<FeedPosition[]>`
    SELECT p.id::text AS id, p.feed_at AS "feedAt"
    FROM unnest(${ownerIds}::uuid[]) AS f(owner_id)
    JOIN account.users u ON u.id = f.owner_id AND u.deactivated_at IS NULL
    CROSS JOIN LATERAL (
      SELECT id, feed_at
      FROM (
        SELECT id,
          date_trunc('milliseconds', published_at)
            - interval '1 hour' * (
                (row_number() OVER (ORDER BY published_at DESC, id ASC) - 1)
                * ${spreadHours}::float8
              ) AS feed_at
        FROM listing.properties
        WHERE user_id = f.owner_id
          AND status = 'Active'
          AND published_at IS NOT NULL
      ) ranked
      ${afterCursor}
      ORDER BY feed_at DESC, id ASC
      LIMIT ${take}
    ) p
    ORDER BY p.feed_at DESC, p.id ASC
    LIMIT ${take}`;
}
