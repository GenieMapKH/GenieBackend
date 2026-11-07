import { Injectable } from '@nestjs/common';
import { Prisma } from '@tilomnov/prisma-client';
import { PrismaService } from '@tilomnov/shared';
import { FavoriteSort } from '../dto/favorites-page.query';
import { toPage } from '../dto/page.query';
import { withoutContactDetails } from '../contact-details';
import { OWNER_CARD_SELECT } from '../property-includes';
import { PropertyEngagementCounts } from './property-engagement-counts.service';

// Saved cards remain recognizable after withdrawal; never return draft details or contacts.
const SAVED_CARD_SELECT = {
  lat: true,
  lng: true,
  boundaryPoints: true,
  id: true,
  title: true,
  price: true,
  propertyType: true,
  listingType: true,
  status: true,
  createdAt: true,
  publishedAt: true,
  bedrooms: true,
  bathrooms: true,
  landSize: true,
  buildingSize: true,
  unitSize: true,
  discountType: true,
  discountValue: true,
  images: { orderBy: { order: 'asc' } },
  user: { select: OWNER_CARD_SELECT },
} as const;

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
 * left out until they return. Withdrawn and sold listings remain as unavailable
 * cards; deleted listings are removed.
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
      include: { property: { select: SAVED_CARD_SELECT } },
      orderBy: ORDER.saved,
    });
    return withoutContactDetails(
      await this.counts.attach(
        favorites.map((favorite) => savedCard(favorite.property)),
      ),
    );
  }

  /** One page of them, in `sort` order. */
  async page(
    userId: string,
    page: { limit: number; offset: number; sort: FavoriteSort },
  ) {
    const favorites = await this.prisma.propertyFavorite.findMany({
      where: this.visibleOf(userId),
      include: { property: { select: SAVED_CARD_SELECT } },
      orderBy: ORDER[page.sort],
      skip: page.offset,
      take: page.limit + 1,
    });
    const listed = toPage(favorites, page.offset, page.limit);
    return {
      ...listed,
      items: withoutContactDetails(
        await this.counts.attach(
          listed.items.map((favorite) => savedCard(favorite.property)),
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
        status: { not: 'Deleted' },
      },
    };
  }
}

/** An unavailable card cannot expose a withdrawn listing's location. */
function savedCard<
  T extends {
    status: string;
    lat: unknown;
    lng: unknown;
    boundaryPoints: unknown;
  },
>(property: T) {
  if (property.status === 'Active') return property;
  const { lat: _lat, lng: _lng, boundaryPoints: _boundary, ...card } = property;
  return card;
}
