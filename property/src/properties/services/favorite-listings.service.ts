import { Injectable } from '@nestjs/common';
import { Prisma } from '@tilomnov/prisma-client';
import { PrismaService } from '@tilomnov/shared';
import { FavoriteSort } from '../dto/favorites-page.query';
import { toPage } from '../dto/page.query';
import { withoutContactDetails } from '../contact-details';
import { PROPERTY_WITH_RELATIONS } from '../property-includes';
import { PropertyEngagementCounts } from './property-engagement-counts.service';

/** Statuses a saved listing is hidden in: the owner has not published it, or removed it. */
const HIDDEN_STATUSES = ['Draft', 'Pending', 'Deleted'];

/** Ties are broken by listing id, so a page never repeats or skips one. */
const ORDER: Record<
  FavoriteSort,
  Prisma.PropertyFavoriteOrderByWithRelationInput[]
> = {
  saved: [{ createdAt: 'desc' }, { propertyId: 'asc' }],
  newest: [{ property: { createdAt: 'desc' } }, { propertyId: 'asc' }],
  priceHigh: [{ property: { price: 'desc' } }, { propertyId: 'asc' }],
  priceLow: [{ property: { price: 'asc' } }, { propertyId: 'asc' }],
};

/**
 * The listings a user saved. One whose owner deactivated their account is
 * left out until they return, and so is one its owner took back to a draft
 * or deleted since it was saved.
 *
 * Lists carry no phone numbers: saving every listing would otherwise be a way
 * round the limit on how many numbers one account may see. Opening a listing
 * shows its number.
 */
@Injectable()
export class FavoriteListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counts: PropertyEngagementCounts,
  ) {}

  /** Every saved listing, most recently saved first. */
  async all(userId: string) {
    const favorites = await this.prisma.propertyFavorite.findMany({
      where: this.visibleOf(userId),
      include: { property: { include: PROPERTY_WITH_RELATIONS } },
      orderBy: ORDER.saved,
    });
    return withoutContactDetails(
      await this.counts.attach(favorites.map((favorite) => favorite.property)),
    );
  }

  /** One page of them, in `sort` order. */
  async page(
    userId: string,
    page: { limit: number; offset: number; sort: FavoriteSort },
  ) {
    const favorites = await this.prisma.propertyFavorite.findMany({
      where: this.visibleOf(userId),
      include: { property: { include: PROPERTY_WITH_RELATIONS } },
      orderBy: ORDER[page.sort],
      skip: page.offset,
      take: page.limit + 1,
    });
    const listed = toPage(favorites, page.offset, page.limit);
    return {
      ...listed,
      items: withoutContactDetails(
        await this.counts.attach(
          listed.items.map((favorite) => favorite.property),
        ),
      ),
    };
  }

  /** Which listings are saved, for the heart on every card: ids only, and all of them. */
  async ids(userId: string): Promise<string[]> {
    const favorites = await this.prisma.propertyFavorite.findMany({
      where: this.visibleOf(userId),
      select: { propertyId: true },
      orderBy: ORDER.saved,
    });
    return favorites.map((favorite) => favorite.propertyId);
  }

  private visibleOf(userId: string) {
    return {
      userId,
      property: {
        user: { deactivatedAt: null },
        status: { notIn: HIDDEN_STATUSES },
      },
    };
  }
}
