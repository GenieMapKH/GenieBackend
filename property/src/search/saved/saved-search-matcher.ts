import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@tilomnov/prisma-client';
import { PrismaService } from '@tilomnov/shared';
import { ListingNotificationsClient } from '../../notifications/listing-notifications.client';
import { PUBLISHED } from '../../properties/property-includes';
import { SIZE_FIELD_BY_TYPE } from '../../properties/property-type-fields';
import { PropertyType } from '../../properties/property-options';
import {
  ListingChanges,
  ListingEventListener,
} from '../../properties/services/listing-changes.service';

/** What a new listing is matched on: what the map filter reads. */
const MATCH_SELECT = {
  id: true,
  userId: true,
  title: true,
  price: true,
  lat: true,
  lng: true,
  propertyType: true,
  listingType: true,
  landSize: true,
  buildingSize: true,
  unitSize: true,
  totalProjectArea: true,
  keywords: { select: { keyword: true } },
} as const;

type MatchedListing = Prisma.PropertyGetPayload<{
  select: typeof MATCH_SELECT;
}>;

type SearchHit = { id: string; userId: string; name: string };

/**
 * When a listing goes live, tells everyone whose saved search would show it
 * on the map: in its area, and passing its filter the way the map filter
 * does (`map-filter.ts`). Each search alerts about a listing once, even if
 * it is unpublished and published again, and each person gets one push per
 * listing however many of their searches match. The owner is never told.
 */
@Injectable()
export class SavedSearchMatcher implements ListingEventListener, OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly changes: ListingChanges,
    private readonly notifications: ListingNotificationsClient,
  ) {}

  onModuleInit(): void {
    this.changes.listenToEvents(this);
  }

  async listingWentLive(propertyId: string): Promise<void> {
    const listing = await this.prisma.property.findFirst({
      where: { id: propertyId, ...PUBLISHED },
      select: MATCH_SELECT,
    });
    if (!listing || listing.lat === null || listing.lng === null) return;

    const hits = await this.matchingSearches(listing);
    if (hits.length === 0) return;
    const fresh = await this.claimNew(propertyId, hits);

    // One push per person: the first of their searches names it.
    const byUser = new Map<string, string>();
    for (const hit of fresh) {
      if (!byUser.has(hit.userId)) byUser.set(hit.userId, hit.name);
    }
    if (byUser.size === 0) return;
    await this.notifications.savedSearchMatch(
      { id: listing.id, title: listing.title },
      [...byUser].map(([userId, searchName]) => ({ userId, searchName })),
    );
  }

  /** The alerting searches of other people that [listing] passes. */
  private matchingSearches(listing: MatchedListing): Promise<SearchHit[]> {
    const size = cardSize(listing);
    const keywords = listing.keywords.map((k) => k.keyword);
    return this.prisma.$queryRaw<SearchHit[]>`
      SELECT s.id::text AS id, s.user_id::text AS "userId", s.name
      FROM listing.saved_searches s
      WHERE s.alerts
        AND s.user_id <> ${listing.userId}::uuid
        AND ${listing.lat} BETWEEN s.min_lat AND s.max_lat
        AND ${listing.lng} BETWEEN s.min_lng AND s.max_lng
        AND (s.property_type IS NULL OR s.property_type = ${listing.propertyType})
        AND (cardinality(s.listing_types) = 0
             OR ${listing.listingType}::text = ANY (s.listing_types))
        AND (s.min_price IS NULL OR ${listing.price} >= s.min_price)
        AND (s.max_price IS NULL OR ${listing.price} <= s.max_price)
        AND (s.min_size IS NULL OR ${size}::numeric >= s.min_size)
        AND (s.max_size IS NULL OR ${size}::numeric <= s.max_size)
        AND s.keywords <@ ${keywords}::text[]
      ORDER BY s.created_at`;
  }

  /** The [hits] not yet told about this listing, now marked as told. */
  private async claimNew(
    propertyId: string,
    hits: SearchHit[],
  ): Promise<SearchHit[]> {
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO listing.saved_search_matches (saved_search_id, property_id)
      SELECT unnest(${hits.map((hit) => hit.id)}::uuid[]), ${propertyId}::uuid
      ON CONFLICT DO NOTHING
      RETURNING saved_search_id::text AS id`;
    const ids = new Set(claimed.map((row) => row.id));
    return hits.filter((hit) => ids.has(hit.id));
  }
}

/**
 * The size the listing's cards show for its type, as the map's size filter
 * reads it. A listing without one (or of no known type) passes no size bound.
 */
function cardSize(listing: MatchedListing): number | null {
  const field = SIZE_FIELD_BY_TYPE[listing.propertyType as PropertyType];
  const value = field ? listing[field] : null;
  if (value === null || value === undefined) return null;
  const size = Number(value);
  return size > 0 ? size : null;
}
