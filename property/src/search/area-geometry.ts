import { MapBounds } from '../properties/services/public-property-cache.service';
import type { PlaceBoundary } from './places/place-provider';

/** Includes the outer border and excludes holes, across every island. */
export function boundaryContains(
  boundary: PlaceBoundary,
  point: { lat: number | null; lng: number | null },
): boolean {
  if (point.lat === null || point.lng === null) return false;
  const { lat, lng } = point;
  const inRing = (ring: number[][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x, y] = ring[i],
        [previousX, previousY] = ring[j];
      const cross = (lng - x) * (previousY - y) - (lat - y) * (previousX - x);
      if (
        Math.abs(cross) < 1e-12 &&
        lng >= Math.min(x, previousX) &&
        lng <= Math.max(x, previousX) &&
        lat >= Math.min(y, previousY) &&
        lat <= Math.max(y, previousY)
      )
        return true;
      if (
        y > lat !== previousY > lat &&
        lng < ((previousX - x) * (lat - y)) / (previousY - y) + x
      )
        inside = !inside;
    }
    return inside;
  };
  return boundary.coordinates.some(
    ([outer, ...holes]) => inRing(outer) && !holes.some(inRing),
  );
}

/** The camera/query bounds cover every polygon, including disconnected parts. */
export function boundaryBounds(boundary: PlaceBoundary): MapBounds {
  const bounds = {
    minLat: Infinity,
    maxLat: -Infinity,
    minLng: Infinity,
    maxLng: -Infinity,
  };
  for (const polygon of boundary.coordinates) {
    for (const [lng, lat] of polygon[0]) {
      bounds.minLat = Math.min(bounds.minLat, lat);
      bounds.maxLat = Math.max(bounds.maxLat, lat);
      bounds.minLng = Math.min(bounds.minLng, lng);
      bounds.maxLng = Math.max(bounds.maxLng, lng);
    }
  }
  return bounds;
}

/**
 * About 500 m. A place that is a single address or a short lane has a tiny
 * (or no) viewport; the listings "in" it are the ones around it.
 */
export const MIN_AREA_SPAN_DEGREES = 0.005;

/** `viewport` grown around `center` until each side spans at least `minSpan` degrees. */
export function withMinimumSpan(
  viewport: MapBounds,
  center: { lat: number; lng: number },
  minSpan = MIN_AREA_SPAN_DEGREES,
): MapBounds {
  const half = minSpan / 2;
  const latTooSmall = viewport.maxLat - viewport.minLat < minSpan;
  const lngTooSmall = viewport.maxLng - viewport.minLng < minSpan;
  return {
    minLat: latTooSmall
      ? Math.min(viewport.minLat, center.lat - half)
      : viewport.minLat,
    maxLat: latTooSmall
      ? Math.max(viewport.maxLat, center.lat + half)
      : viewport.maxLat,
    minLng: lngTooSmall
      ? Math.min(viewport.minLng, center.lng - half)
      : viewport.minLng,
    maxLng: lngTooSmall
      ? Math.max(viewport.maxLng, center.lng + half)
      : viewport.maxLng,
  };
}

interface Located {
  lat: number | null;
  lng: number | null;
}

/**
 * The `limit` items nearest `center`, nearest first. A planar distance with
 * longitude scaled by latitude: enough to rank listings inside one area.
 */
export function nearestFirst<T extends Located>(
  items: T[],
  center: { lat: number; lng: number },
  limit: number,
): T[] {
  const lngScale = Math.cos((center.lat * Math.PI) / 180);
  const distance = (item: T) => {
    if (item.lat === null || item.lng === null) return Number.POSITIVE_INFINITY;
    const dLat = item.lat - center.lat;
    const dLng = (item.lng - center.lng) * lngScale;
    return dLat * dLat + dLng * dLng;
  };

  return items
    .map((item) => ({ item, distance: distance(item) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(({ item }) => item);
}
