import { NearbyCategory } from './nearby-categories';

export interface LatLng {
  lat: number;
  lng: number;
}

/** A place the map provider knows, e.g. a market. */
export interface FoundPlace {
  providerPlaceId: string;
  name: string;
  location: LatLng;
}

/** How far a place is by road. */
export interface RoadDistance {
  meters: number;
  seconds: number;
}

/**
 * Finds the places of a category around a point. The nearby service knows
 * only this contract, so the map provider can be swapped without touching it.
 */
export abstract class NearbyPlaceProvider {
  /** False without credentials: nothing is looked up then. */
  abstract readonly isConfigured: boolean;

  /** At most `limit` places within `radiusMeters`, closest first. */
  abstract findNearest(
    category: NearbyCategory,
    center: LatLng,
    radiusMeters: number,
    limit: number,
  ): Promise<FoundPlace[]>;
}

/** Measures how far places are by road. */
export abstract class RouteDistanceProvider {
  abstract readonly isConfigured: boolean;

  /**
   * The driving distance from `origin` to each destination, in the same
   * order; null for one that has no road to it.
   */
  abstract roadDistances(
    origin: LatLng,
    destinations: LatLng[],
  ): Promise<(RoadDistance | null)[]>;
}

/** The drawn road from one point to another. */
export interface RoutePath {
  meters: number;
  /** Google's encoded polyline (precision 5) of the road. */
  polyline: string;
}

/** Draws the road between two points, for the map. */
export abstract class RoutePathProvider {
  abstract readonly isConfigured: boolean;

  /** The driving road from `origin` to `destination`; null when there is none. */
  abstract drivePath(
    origin: LatLng,
    destination: LatLng,
  ): Promise<RoutePath | null>;
}
