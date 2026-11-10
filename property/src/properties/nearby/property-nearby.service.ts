import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@tilomnov/shared';
import { PublicPropertyCache } from '../services/public-property-cache.service';
import {
  categoriesFor,
  NearbyCategory,
  PLACES_PER_CATEGORY,
  SEARCH_RADIUS_METERS,
  straightMeters,
} from './nearby-categories';
import {
  FoundPlace,
  LatLng,
  NearbyPlaceProvider,
  RoadDistance,
  RouteDistanceProvider,
} from './nearby-providers';

/** What a lookup was made for; a result for anything else is out of date. */
interface LookupTarget {
  location: LatLng;
  categories: NearbyCategory[];
}

interface NearbyRow {
  category: NearbyCategory;
  rank: number;
  name: string;
  providerPlaceId: string;
  lat: number;
  lng: number;
  straightMeters: number;
  roadMeters: number | null;
  driveSeconds: number | null;
}

/**
 * Finds the nearest markets, hospitals and schools of a listing tagged
 * near_market, near_hospital or near_school, with their road distance, and
 * stores them with the listing. Runs when the listing is placed or its tags
 * change, after the save has answered: a slow or failing provider never
 * holds up or fails the save, and viewing a listing never calls the provider.
 */
@Injectable()
export class PropertyNearbyService {
  private readonly logger = new Logger(PropertyNearbyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly places: NearbyPlaceProvider,
    private readonly routes: RouteDistanceProvider,
    private readonly publicCache: PublicPropertyCache,
  ) {}

  /** After the listing moved: look again, in the background. */
  locationChanged(propertyId: string): void {
    this.refreshInBackground(propertyId);
  }

  /** After an edit of the tags: look again only if the asked categories changed. */
  keywordsChanged(propertyId: string, before: string[], after: string[]): void {
    if (categoriesFor(before).join() !== categoriesFor(after).join()) {
      this.refreshInBackground(propertyId);
    }
  }

  private refreshInBackground(propertyId: string): void {
    this.refresh(propertyId).catch((error: unknown) =>
      this.logger.error(
        `Nearby places of ${propertyId} not updated`,
        error as Error,
      ),
    );
  }

  /** Looks up and stores the listing's nearby places now. */
  async refresh(propertyId: string): Promise<void> {
    const target = await this.currentTarget(propertyId);
    // Not placed on the map yet (or gone): nothing to measure from.
    if (!target) return;

    if (target.categories.length === 0) {
      await this.save(propertyId, target, [], null);
      return;
    }
    if (!this.places.isConfigured) return;

    const found = await Promise.all(
      target.categories.map((category) =>
        this.places.findNearest(
          category,
          target.location,
          SEARCH_RADIUS_METERS,
          PLACES_PER_CATEGORY,
        ),
      ),
    );
    const roads = await this.roadDistances(
      target.location,
      found.flat().map((place) => place.location),
    );

    let next = 0;
    const rows = target.categories.flatMap((category, i) =>
      this.rank(
        category,
        target.location,
        found[i].map((place) => ({ place, road: roads[next++] })),
      ),
    );
    await this.save(propertyId, target, rows, new Date());
  }

  /** Road distances, or none at all when the routing provider is unavailable. */
  private async roadDistances(
    origin: LatLng,
    places: LatLng[],
  ): Promise<(RoadDistance | null)[]> {
    if (!this.routes.isConfigured || places.length === 0)
      return places.map(() => null);
    try {
      return await this.routes.roadDistances(origin, places);
    } catch (error) {
      // The places are still worth showing, with the straight-line distance.
      this.logger.warn(
        `Road distances unavailable: ${(error as Error).message}`,
      );
      return places.map(() => null);
    }
  }

  /** Closest by road first; a place with no road comes after those with one. */
  private rank(
    category: NearbyCategory,
    origin: LatLng,
    places: { place: FoundPlace; road: RoadDistance | null }[],
  ): NearbyRow[] {
    return places
      .map(({ place, road }) => ({
        category,
        name: place.name,
        providerPlaceId: place.providerPlaceId,
        lat: place.location.lat,
        lng: place.location.lng,
        straightMeters: straightMeters(origin, place.location),
        roadMeters: road?.meters ?? null,
        driveSeconds: road?.seconds ?? null,
      }))
      .sort(
        (a, b) =>
          (a.roadMeters ?? Infinity) - (b.roadMeters ?? Infinity) ||
          a.straightMeters - b.straightMeters,
      )
      .map((row, rank) => ({ ...row, rank }));
  }

  private async currentTarget(
    propertyId: string,
  ): Promise<LookupTarget | null> {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { lat: true, lng: true, keywords: { select: { keyword: true } } },
    });
    if (!property || property.lat == null || property.lng == null) return null;
    return {
      location: { lat: property.lat, lng: property.lng },
      categories: categoriesFor(property.keywords.map((k) => k.keyword)),
    };
  }

  /**
   * Replaces the stored places, unless the listing moved or was re-tagged
   * while looking (a newer lookup then writes). One lookup writes at a time
   * per listing.
   */
  private async save(
    propertyId: string,
    target: LookupTarget,
    rows: NearbyRow[],
    searchedAt: Date | null,
  ): Promise<void> {
    const status = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${propertyId}))`;

      const now = await tx.property.findUnique({
        where: { id: propertyId },
        select: {
          lat: true,
          lng: true,
          status: true,
          keywords: { select: { keyword: true } },
        },
      });
      const stillCurrent =
        now?.lat === target.location.lat &&
        now?.lng === target.location.lng &&
        categoriesFor(now.keywords.map((k) => k.keyword)).join() ===
          target.categories.join();
      if (!stillCurrent) return null;

      await tx.propertyNearbyPlace.deleteMany({ where: { propertyId } });
      if (rows.length > 0) {
        await tx.propertyNearbyPlace.createMany({
          data: rows.map((row) => ({ ...row, propertyId })),
        });
      }
      await tx.property.update({
        where: { id: propertyId },
        data: { nearbySearchedAt: searchedAt },
      });
      return now.status;
    });

    // Only the listing's own page shows its nearby places.
    if (status === 'Active') await this.publicCache.detailChanged(propertyId);
  }
}
