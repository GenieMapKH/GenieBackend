import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JsonCache, PrismaService } from '@tilomnov/shared';
import { NearbyCategory } from './nearby-categories';
import { RoutePath, RoutePathProvider } from './nearby-providers';

/** A road does not change; a moved listing or place gets a new key anyway. */
const ROUTE_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Only listings and places the public can see. */
const PUBLISHED_LISTING = {
  status: 'Active',
  user: { deactivatedAt: null },
} as const;

/**
 * The road from a listing to one of its stored nearby places, for the map.
 * Asked for only when a visitor opens a place, and kept per listing and
 * place, so the provider is paid once for each road however often it is seen.
 */
@Injectable()
export class NearbyRouteService {
  private readonly logger = new Logger(NearbyRouteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paths: RoutePathProvider,
    private readonly cache: JsonCache,
  ) {}

  async routeTo(
    propertyId: string,
    category: NearbyCategory,
    rank: number,
  ): Promise<RoutePath> {
    const place = await this.prisma.propertyNearbyPlace.findFirst({
      where: { propertyId, category, rank, property: PUBLISHED_LISTING },
      select: {
        lat: true,
        lng: true,
        property: { select: { lat: true, lng: true } },
      },
    });
    if (!place || place.property.lat == null || place.property.lng == null) {
      throw new NotFoundException('Place not found');
    }
    if (!this.paths.isConfigured) {
      throw new ServiceUnavailableException('Routes are not available');
    }

    const from = { lat: place.property.lat, lng: place.property.lng };
    const to = { lat: place.lat, lng: place.lng };
    // The coordinates are in the key: the listing or place moving makes a new road.
    const key =
      `properties:nearby-route:${propertyId}:${category}:${rank}:` +
      `${from.lat},${from.lng}:${to.lat},${to.lng}`;

    return this.cache.remember(key, ROUTE_TTL_SECONDS, async () => {
      const path = await this.load(from, to);
      if (!path) throw new NotFoundException('No road to this place');
      return path;
    });
  }

  private async load(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
  ): Promise<RoutePath | null> {
    try {
      return await this.paths.drivePath(from, to);
    } catch (error) {
      this.logger.warn(`Route unavailable: ${(error as Error).message}`);
      throw new ServiceUnavailableException('Routes are not available');
    }
  }
}
