import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@tilomnov/prisma-client';
import { PrismaService } from '@tilomnov/shared';
import { OwnListingStatus } from '../dto/own-listings-page.query';
import { toPage } from '../dto/page.query';
import { PROPERTY_WITH_RELATIONS } from '../property-includes';
import { PropertyEngagementCounts } from './property-engagement-counts.service';
import { MapBounds } from './public-property-cache.service';

/** The most of their own listings one map area returns: the newest ones. */
export const OWN_MAP_LIMIT = 500;

/** Newest first; ties broken by id, so a page never repeats or skips one. */
const NEWEST_FIRST: Prisma.PropertyOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'asc' },
];

/** A user's own listings, whatever their status, except deleted ones. */
@Injectable()
export class OwnerListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counts: PropertyEngagementCounts,
  ) {}

  /** All of them, newest first. */
  async all(userId: string) {
    const properties = await this.prisma.property.findMany({
      where: this.ownedBy(userId),
      include: PROPERTY_WITH_RELATIONS,
      orderBy: NEWEST_FIRST,
    });
    return this.counts.attach(properties);
  }

  /**
   * One page of them, newest first: the My Properties screen; with
   * `statuses`, only those in one of them (a tab). With how many there are in
   * each status, for its tabs, which count all of them.
   */
  async page(
    userId: string,
    page: { limit: number; offset: number },
    statuses?: readonly OwnListingStatus[],
  ) {
    const [properties, byStatus] = await Promise.all([
      this.prisma.property.findMany({
        where: statuses?.length
          ? { userId, status: { in: [...statuses] } }
          : this.ownedBy(userId),
        include: PROPERTY_WITH_RELATIONS,
        orderBy: NEWEST_FIRST,
        skip: page.offset,
        take: page.limit + 1,
      }),
      this.prisma.property.groupBy({
        by: ['status'],
        where: this.ownedBy(userId),
        _count: { _all: true },
      }),
    ]);
    const listed = toPage(properties, page.offset, page.limit);
    return {
      ...listed,
      items: await this.counts.attach(listed.items),
      countByStatus: Object.fromEntries(
        byStatus.map((group) => [group.status, group._count._all]),
      ),
    };
  }

  /**
   * Those inside the map's area, drafts included, so the map can mark the
   * user's own listings and let them edit them.
   */
  async inArea(userId: string, bounds: MapBounds) {
    if (bounds.minLat > bounds.maxLat || bounds.minLng > bounds.maxLng) {
      throw new BadRequestException('The map bounds are the wrong way round');
    }
    const properties = await this.prisma.property.findMany({
      where: {
        ...this.ownedBy(userId),
        lat: { gte: bounds.minLat, lte: bounds.maxLat },
        lng: { gte: bounds.minLng, lte: bounds.maxLng },
      },
      include: PROPERTY_WITH_RELATIONS,
      orderBy: NEWEST_FIRST,
      take: OWN_MAP_LIMIT,
    });
    return this.counts.attach(properties);
  }

  private ownedBy(userId: string) {
    return { userId, status: { not: 'Deleted' } };
  }
}
