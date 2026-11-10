import { Injectable, Logger } from '@nestjs/common';
import { NearbyCategory } from './nearby-categories';
import {
  FoundPlace,
  LatLng,
  NearbyPlaceProvider,
  RoadDistance,
  RouteDistanceProvider,
  RoutePath,
  RoutePathProvider,
} from './nearby-providers';

const NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const ROUTE_MATRIX_URL =
  'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

/** Runs after the listing is saved, so it may take longer than a search bar. */
const TIMEOUT_MS = 10_000;

/**
 * Google's types for each category. Markets include supermarkets (but not
 * every corner shop); hospitals exclude clinics; schools cover all levels.
 */
const TYPES_BY_CATEGORY: Record<NearbyCategory, string[]> = {
  market: ['market', 'supermarket'],
  hospital: ['hospital'],
  school: ['school', 'primary_school', 'secondary_school'],
};

/** Only these fields: they keep the call on the cheaper Nearby Search Pro SKU. */
const NEARBY_FIELDS = 'places.id,places.displayName,places.location';
const ROUTE_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const ROUTE_FIELDS = 'routes.distanceMeters,routes.polyline.encodedPolyline';
const MATRIX_FIELDS =
  'originIndex,destinationIndex,distanceMeters,duration,condition';

/** Names of places as Cambodians write them in English, e.g. "Phsar Thmei". */
const LANGUAGE = 'en';

/** The provider answered with an error status. */
export class GoogleRequestError extends Error {
  constructor(
    readonly api: string,
    readonly status: number,
  ) {
    super(`${api} answered ${status}`);
  }
}

/**
 * Both APIs use the same server key, `GOOGLE_PLACES_API_KEY`, which needs
 * the Places API (New) and the Routes API enabled.
 */
function apiKey(): string {
  return process.env.GOOGLE_PLACES_API_KEY ?? '';
}

async function post<T>(
  api: string,
  url: string,
  fieldMask: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new GoogleRequestError(api, response.status);
  return (await response.json()) as T;
}

const toGoogle = (point: LatLng) => ({
  latitude: point.lat,
  longitude: point.lng,
});

interface NearbyResponse {
  places?: {
    id: string;
    displayName?: { text: string };
    location?: { latitude: number; longitude: number };
  }[];
}

/** Google Places API (New), Nearby Search ranked by distance. */
@Injectable()
export class GoogleNearbyPlaceProvider extends NearbyPlaceProvider {
  private readonly logger = new Logger(GoogleNearbyPlaceProvider.name);

  constructor() {
    super();
    if (!this.isConfigured) {
      this.logger.warn(
        'GOOGLE_PLACES_API_KEY is not set: listings will not show nearby markets, hospitals or schools.',
      );
    }
  }

  get isConfigured(): boolean {
    return apiKey() !== '';
  }

  async findNearest(
    category: NearbyCategory,
    center: LatLng,
    radiusMeters: number,
    limit: number,
  ): Promise<FoundPlace[]> {
    const response = await post<NearbyResponse>(
      'Places API',
      NEARBY_URL,
      NEARBY_FIELDS,
      {
        includedTypes: TYPES_BY_CATEGORY[category],
        maxResultCount: limit,
        rankPreference: 'DISTANCE',
        languageCode: LANGUAGE,
        locationRestriction: {
          circle: { center: toGoogle(center), radius: radiusMeters },
        },
      },
    );

    return (response.places ?? []).flatMap((place) =>
      place.location
        ? [
            {
              providerPlaceId: place.id,
              name: place.displayName?.text ?? '',
              location: {
                lat: place.location.latitude,
                lng: place.location.longitude,
              },
            },
          ]
        : [],
    );
  }
}

interface MatrixElement {
  destinationIndex?: number;
  distanceMeters?: number;
  /** e.g. "380s". */
  duration?: string;
  condition?: string;
}

/** Google Routes API, one route matrix for all the places of a listing. */
@Injectable()
export class GoogleRouteDistanceProvider extends RouteDistanceProvider {
  get isConfigured(): boolean {
    return apiKey() !== '';
  }

  async roadDistances(
    origin: LatLng,
    destinations: LatLng[],
  ): Promise<(RoadDistance | null)[]> {
    if (destinations.length === 0) return [];

    const elements = await post<MatrixElement[]>(
      'Routes API',
      ROUTE_MATRIX_URL,
      MATRIX_FIELDS,
      {
        origins: [{ waypoint: { location: { latLng: toGoogle(origin) } } }],
        destinations: destinations.map((point) => ({
          waypoint: { location: { latLng: toGoogle(point) } },
        })),
        travelMode: 'DRIVE',
        // Typical distance and time, not today's traffic: cheaper, and steadier for a listing.
        routingPreference: 'TRAFFIC_UNAWARE',
      },
    );

    const distances: (RoadDistance | null)[] = destinations.map(() => null);
    for (const element of elements) {
      // An element with no index refers to destination 0 (proto3 default).
      const index = element.destinationIndex ?? 0;
      if (element.condition !== 'ROUTE_EXISTS' || index >= distances.length)
        continue;
      distances[index] = {
        meters: element.distanceMeters ?? 0,
        seconds: parseInt(element.duration ?? '0', 10) || 0,
      };
    }
    return distances;
  }
}

interface RoutesResponse {
  routes?: {
    distanceMeters?: number;
    polyline?: { encodedPolyline?: string };
  }[];
}

/** Google Routes API, the road of one route. */
@Injectable()
export class GoogleRoutePathProvider extends RoutePathProvider {
  get isConfigured(): boolean {
    return apiKey() !== '';
  }

  async drivePath(
    origin: LatLng,
    destination: LatLng,
  ): Promise<RoutePath | null> {
    const response = await post<RoutesResponse>(
      'Routes API',
      ROUTE_URL,
      ROUTE_FIELDS,
      {
        origin: { location: { latLng: toGoogle(origin) } },
        destination: { location: { latLng: toGoogle(destination) } },
        travelMode: 'DRIVE',
        // The same basis as the distances shown in the list.
        routingPreference: 'TRAFFIC_UNAWARE',
      },
    );

    const route = response.routes?.[0];
    const polyline = route?.polyline?.encodedPolyline;
    if (!route || !polyline) return null;
    return { meters: route.distanceMeters ?? 0, polyline };
  }
}
