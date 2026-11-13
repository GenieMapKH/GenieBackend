import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { boundaryBounds, boundaryContains } from '../area-geometry';
import { cambodiaBoundary } from './cambodia-boundaries';
import { PlaceArea, PlaceBoundary } from './place-provider';

const place = (name: string, lat: number, lng: number): PlaceArea => ({
  placeId: 'test',
  name,
  address: null,
  center: { lat, lng },
  viewport: { minLat: lat, maxLat: lat, minLng: lng, maxLng: lng },
});

describe('Cambodia boundary matching', () => {
  it('distinguishes Kampot province from Kampot city', () => {
    const kampot = place('Kampot', 10.606, 104.181);
    const province = cambodiaBoundary(kampot, ['administrative_area_level_1']);
    const city = cambodiaBoundary(kampot, ['locality']);
    expect(province).toBeDefined();
    expect(city).toBeDefined();
    expect(boundaryBounds(province!).maxLat).toBeGreaterThan(11);
    expect(boundaryBounds(city!).maxLat).toBeLessThan(10.7);
  });

  it('matches Chom Chau spelling variants but never assigns the old shape to a new subdivision', () => {
    for (const name of [
      'Chom Chau',
      'Chom Chao',
      'Chaom Chau',
      'Sangkat Choam Chau',
    ]) {
      const shape = cambodiaBoundary(place(name, 11.525, 104.83), [
        'sublocality_level_1',
      ]);
      expect(shape).toBeDefined();
      expect(shape!.coordinates[0][0].length).toBeGreaterThan(4);
    }
    expect(
      cambodiaBoundary(place('Chom Chau 1', 11.525, 104.83), [
        'sublocality_level_1',
      ]),
    ).toBeUndefined();
  });

  it('does not outline a namesake, a business, or an unmapped place', () => {
    expect(
      cambodiaBoundary(place('Kampot', 13, 105), ['locality']),
    ).toBeUndefined();
    expect(
      cambodiaBoundary(place('Kampot', 10.606, 104.181), ['restaurant']),
    ).toBeUndefined();
    expect(
      cambodiaBoundary(place('Unknown', 11.525, 104.83), ['sublocality']),
    ).toBeUndefined();
  });

  it('ships closed, finite, geographic rings for every source boundary', () => {
    const data = JSON.parse(
      readFileSync(join(__dirname, 'data/cambodia-boundaries.json'), 'utf8'),
    ) as { geometry: PlaceBoundary }[];
    expect(data).toHaveLength(1855);
    for (const { geometry } of data) {
      expect(geometry.coordinates.length).toBeGreaterThan(0);
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) {
          expect(ring.length).toBeGreaterThanOrEqual(4);
          expect(ring[0]).toEqual(ring[ring.length - 1]);
          expect(
            ring.every(
              ([lng, lat]) =>
                Number.isFinite(lng) &&
                Number.isFinite(lat) &&
                Math.abs(lng) <= 180 &&
                Math.abs(lat) <= 90,
            ),
          ).toBe(true);
        }
      }
    }
  });
});

describe('boundary geometry', () => {
  const boundary: PlaceBoundary = {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [0, 0],
          [4, 0],
          [0, 4],
          [0, 0],
        ],
        [
          [1, 1],
          [2, 1],
          [1, 2],
          [1, 1],
        ],
      ],
      [
        [
          [5, 0],
          [6, 0],
          [5, 1],
          [5, 0],
        ],
      ],
    ],
  };
  it('excludes box corners and holes, includes islands and the outer border', () => {
    expect(boundaryContains(boundary, { lng: 3, lat: 3 })).toBe(false);
    expect(boundaryContains(boundary, { lng: 0.5, lat: 0.5 })).toBe(true);
    expect(boundaryContains(boundary, { lng: 1.2, lat: 1.2 })).toBe(false);
    expect(boundaryContains(boundary, { lng: 5.2, lat: 0.2 })).toBe(true);
    expect(boundaryContains(boundary, { lng: 0, lat: 2 })).toBe(true);
    expect(boundaryContains(boundary, { lng: null, lat: null })).toBe(false);
    expect(boundaryBounds(boundary)).toEqual({
      minLat: 0,
      maxLat: 4,
      minLng: 0,
      maxLng: 6,
    });
  });
});
