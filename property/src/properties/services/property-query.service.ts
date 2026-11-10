import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService, ReadPrisma } from '@tilomnov/shared';
import {
  MAP_SELECT,
  PROPERTY_WITH_RELATIONS,
  PUBLISHED,
} from '../property-includes';
import {
  PropertyEngagementCounts,
  withEngagement,
} from './property-engagement-counts.service';
import { MapFilter, mapFilterWhere, withoutPrice } from '../map-filter';
import { PRICE_HISTOGRAM_SAMPLE, priceHistogram } from '../map-price-histogram';
import {
  MapBounds,
  PublicPropertyCache,
  widenToGrid,
} from './public-property-cache.service';

/** Read-only property lookups. */
/** The most listings one map search returns: the newest ones in the area. */
export const MAP_RESULT_LIMIT = 500;

@Injectable()
export class PropertyQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publicCache: PublicPropertyCache,
    private readonly counts: PropertyEngagementCounts,
    /** For what every visitor sees; the owner's own reads use `prisma`. */
    private readonly publicReads: ReadPrisma,
  ) {}

  /** One property owned by `userId`; 404 if it is missing, deleted or not theirs. */
  async findOwned(userId: string, id: string) {
    // Counted alongside the read: the id is already known.
    const [property, counts] = await Promise.all([
      this.prisma.property.findFirst({
        where: { id, userId, status: { not: 'Deleted' } },
        include: PROPERTY_WITH_RELATIONS,
      }),
      this.counts.of([id]),
    ]);
    if (!property) {
      throw new NotFoundException('Property not found');
    }
    return withEngagement(property, counts);
  }

  /** A published property, visible to anyone. */
  findPublic(id: string) {
    return this.publicCache.detail(id, async () => {
      const [property, counts] = await Promise.all([
        this.publicReads.property.findFirst({
          where: { id, ...PUBLISHED },
          include: PROPERTY_WITH_RELATIONS,
        }),
        this.counts.of([id]),
      ]);
      if (!property) {
        throw new NotFoundException('Property not found or not active');
      }
      return withEngagement(property, counts);
    });
  }

  /**
   * Published properties in (slightly more than) the map viewport, flagged
   * `isVisited` for `userId`. The list is shared by everyone looking at that
   * area and `filter`; only the flag is looked up per user.
   */
  async searchMap(bounds: MapBounds, userId?: string, filter: MapFilter = {}) {
    const box = gridBox(bounds);
    const properties = await this.publicCache.map(box, filter, async () =>
      this.counts.attach(
        await this.publicReads.property.findMany({
          where: {
            ...PUBLISHED,
            ...mapFilterWhere(filter),
            ...inBox(box),
          },
          select: MAP_SELECT,
          // A zoomed-out map would otherwise receive every listing there is.
          orderBy: { createdAt: 'desc' },
          take: MAP_RESULT_LIMIT,
        }),
      ),
    );

    const visited = await this.visitedAmong(
      userId,
      properties.map((property) => property.id),
    );
    return properties.map((property) => ({
      ...property,
      isVisited: visited.has(property.id),
    }));
  }

  /**
   * How the asking prices of the listings `searchMap` would find spread from
   * 0 to `upTo`, whatever price range `filter` asks for: the bars behind the
   * filter's price slider.
   */
  async priceHistogram(bounds: MapBounds, filter: MapFilter, upTo: number) {
    const box = gridBox(bounds);
    const unpriced = withoutPrice(filter);
    const counts = await this.publicCache.map(
      box,
      unpriced,
      async () => {
        const rows = await this.publicReads.property.findMany({
          where: { ...PUBLISHED, ...mapFilterWhere(unpriced), ...inBox(box) },
          select: { price: true },
          take: PRICE_HISTOGRAM_SAMPLE,
        });
        return priceHistogram(
          rows.map((row) => Number(row.price)),
          upTo,
        );
      },
      `prices:${upTo}`,
    );
    return { counts };
  }

  private async visitedAmong(
    userId: string | undefined,
    propertyIds: string[],
  ): Promise<Set<string>> {
    if (!userId || propertyIds.length === 0) return new Set();

    const views = await this.prisma.propertyView.findMany({
      where: { userId, propertyId: { in: propertyIds } },
      select: { propertyId: true },
    });
    return new Set(views.map((view) => view.propertyId));
  }
}

function gridBox(bounds: MapBounds): MapBounds {
  if (bounds.minLat > bounds.maxLat || bounds.minLng > bounds.maxLng) {
    throw new BadRequestException('The map bounds are the wrong way round');
  }
  return widenToGrid(bounds);
}

function inBox(box: MapBounds) {
  return {
    lat: { gte: box.minLat, lte: box.maxLat },
    lng: { gte: box.minLng, lte: box.maxLng },
  };
}
