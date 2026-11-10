import { Injectable } from '@nestjs/common';
import { ReadPrisma } from '@tilomnov/shared';
import { GeoPoint, ListingPosition, rankByDistance } from '../closest-listings';
import { MapFilter, mapFilterWhere } from '../map-filter';
import { MAP_SELECT, PUBLISHED } from '../property-includes';
import { PropertyEngagementCounts } from './property-engagement-counts.service';
import { PublicPropertyCache } from './public-property-cache.service';
import { inOrderOf } from './property-search.service';

/**
 * The most listings ranked by distance, the newest kept. Positions are three
 * small columns, so this many are a few hundred kilobytes; past it, ranking
 * belongs in the database (a spatial index).
 */
export const CLOSEST_RANKED_LIMIT = 20_000;

/**
 * Every published listing on the map, nearest to a point first: the list
 * under the map's pull-up sheet. Public reads, shared by everyone asking
 * with the same filter; only the ranking is per point.
 */
@Injectable()
export class ClosestListingsService {
  constructor(
    private readonly prisma: ReadPrisma,
    private readonly publicCache: PublicPropertyCache,
    private readonly counts: PropertyEngagementCounts,
  ) {}

  async page(
    origin: GeoPoint,
    filter: MapFilter,
    page: { limit: number; offset: number },
  ) {
    const ranked = rankByDistance(origin, await this.positions(filter));
    // One more than the page: it only tells that there is another page.
    const window = ranked.slice(page.offset, page.offset + page.limit + 1);
    const shown = window.slice(0, page.limit);
    const distances = new Map(shown.map((p) => [p.id, p.distanceMeters]));

    const cards = await this.cards(shown.map((p) => p.id));
    return {
      items: cards.map((card) => ({
        ...card,
        distanceMeters: distances.get(card.id) ?? 0,
      })),
      // From the ranking, not the cards: a listing hidden in between
      // leaves this page one short, never the next one shifted.
      nextOffset: window.length > page.limit ? page.offset + page.limit : null,
    };
  }

  private positions(filter: MapFilter): Promise<ListingPosition[]> {
    return this.publicCache.positions(filter, async () => {
      const rows = await this.prisma.property.findMany({
        where: {
          ...PUBLISHED,
          ...mapFilterWhere(filter),
          lat: { not: null },
          lng: { not: null },
        },
        select: { id: true, lat: true, lng: true },
        orderBy: { createdAt: 'desc' },
        take: CLOSEST_RANKED_LIMIT,
      });
      return rows.map((row) => ({ id: row.id, lat: row.lat!, lng: row.lng! }));
    });
  }

  /** The cards of `ids`, in that order; one no longer published is left out. */
  private async cards(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.prisma.property.findMany({
      where: { ...PUBLISHED, id: { in: ids } },
      select: MAP_SELECT,
    });
    return this.counts.attach(inOrderOf(ids, rows));
  }
}
