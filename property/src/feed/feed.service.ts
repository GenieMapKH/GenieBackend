import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@tilomnov/prisma-client';
import { PrismaService } from '@tilomnov/shared';
import { FEED_CARD_SELECT } from './feed-card.select';
import { FeedCursor, encodeFeedCursor } from './feed-cursor';
import { nextFeedPositions } from './feed-listing-ids';
import { FEED_SPREAD_HOURS } from './feed-spread';
import { FollowedAccounts } from './followed-accounts';
import { FeedFilters } from './feed-filters';

type FeedCard = Prisma.PropertyGetPayload<{ select: typeof FEED_CARD_SELECT }>;

/** One page of the feed, and the cursor of the next (null after the last). */
export interface FeedPage {
  items: FeedCard[];
  nextCursor: string | null;
}

/**
 * The feed: live listings of the people a user follows, most recently
 * published first, with one owner's burst of listings spread out among the
 * others (see `nextFeedPositions`). Read when asked (no stored feed): a user
 * follows at most 500 people, and the page is found from each one's best
 * listings. A listing whose owner deactivated their account is left out
 * until they return.
 */
@Injectable()
export class FeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly followed: FollowedAccounts,
    @Inject(FEED_SPREAD_HOURS) private readonly spreadHours: number,
  ) {}

  async page(
    userId: string,
    page: FeedFilters & { limit: number; after?: FeedCursor },
  ): Promise<FeedPage> {
    const ownerIds = await this.followed.idsFollowedBy(userId);
    if (ownerIds.length === 0) return { items: [], nextCursor: null };

    // One more than the page: it only tells that there is another page.
    const positions = await nextFeedPositions(
      this.prisma,
      ownerIds,
      page.limit + 1,
      this.spreadHours,
      page.after,
      page,
    );
    const shown = positions.slice(0, page.limit);
    const last = shown[shown.length - 1];

    return {
      items: await this.cards(shown.map((position) => position.id)),
      // From the positions, not the cards: a listing sold in between leaves
      // the page one short, never the next page shifted.
      nextCursor:
        positions.length > page.limit && last
          ? encodeFeedCursor({
              feedAt: last.feedAt,
              id: last.id,
              sort: page.sort,
              sortValue: last.sortValue,
            })
          : null,
    };
  }

  /** The cards of `ids`, in that order; one no longer live is left out. */
  private async cards(ids: string[]): Promise<FeedCard[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.property.findMany({
      where: { id: { in: ids }, status: 'Active' },
      select: FEED_CARD_SELECT,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }
}
