/** Where a listing is on the map: what ranking by distance needs of it. */
export interface ListingPosition {
  id: string;
  lat: number;
  lng: number;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance between `a` and `b`, in metres. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) *
      Math.cos(radians(b.lat)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * `positions` nearest to `origin` first, each with its distance in whole
 * metres. Equally far listings are ordered by id, so every page of the same
 * question cuts the list at the same places.
 */
export function rankByDistance(
  origin: GeoPoint,
  positions: ListingPosition[],
): (ListingPosition & { distanceMeters: number })[] {
  return positions
    .map((position) => ({
      ...position,
      distanceMeters: Math.round(distanceMeters(origin, position)),
    }))
    .sort(
      (a, b) =>
        a.distanceMeters - b.distanceMeters ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}
