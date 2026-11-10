export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Average position of the boundary points, or null when there are none. */
export function boundaryCentroid(points: unknown): GeoPoint | null {
  if (!Array.isArray(points) || points.length === 0) return null;

  const sum = (points as Partial<GeoPoint>[]).reduce<GeoPoint>(
    (total, point) => ({
      lat: total.lat + (point.lat || 0),
      lng: total.lng + (point.lng || 0),
    }),
    { lat: 0, lng: 0 },
  );

  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}
