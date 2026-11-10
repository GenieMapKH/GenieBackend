import { categoriesFor, straightMeters } from './nearby-categories';
import { NearbyPlaceProvider, RouteDistanceProvider } from './nearby-providers';
import { PropertyNearbyService } from './property-nearby.service';

const HOME = { lat: 11.55, lng: 104.92 };

/** A listing as the service reads it. */
function listing(
  keywords: string[],
  location: { lat: number; lng: number } | null = HOME,
) {
  return {
    lat: location?.lat ?? null,
    lng: location?.lng ?? null,
    status: 'Active',
    keywords: keywords.map((keyword) => ({ keyword })),
  };
}

describe('categoriesFor', () => {
  it('asks only for the categories tagged, in display order', () => {
    expect(
      categoriesFor(['near_school', 'road_access', 'near_market']),
    ).toEqual(['market', 'school']);
    expect(categoriesFor(['corner_land'])).toEqual([]);
  });
});

describe('straightMeters', () => {
  it('measures about 1.1 km per 0.01 degree of latitude', () => {
    expect(straightMeters(HOME, { lat: 11.56, lng: 104.92 })).toBe(1112);
    expect(straightMeters(HOME, HOME)).toBe(0);
  });
});

describe('PropertyNearbyService', () => {
  let current: ReturnType<typeof listing> | null;
  let written: { deleted: number; created: object[]; searchedAt?: Date | null };
  let places: jest.Mocked<NearbyPlaceProvider>;
  let routes: jest.Mocked<RouteDistanceProvider>;
  let publicCache: { changed: jest.Mock; detailChanged: jest.Mock };
  let service: PropertyNearbyService;

  beforeEach(() => {
    current = listing(['near_market', 'near_school']);
    written = { deleted: 0, created: [] };
    const tx = {
      $executeRaw: jest.fn(),
      property: {
        findUnique: jest.fn(() => Promise.resolve(current)),
        update: jest.fn(({ data }) => {
          written.searchedAt = data.nearbySearchedAt;
          return Promise.resolve();
        }),
      },
      propertyNearbyPlace: {
        deleteMany: jest.fn(() => {
          written.deleted++;
          return Promise.resolve();
        }),
        createMany: jest.fn(({ data }) => {
          written.created = data;
          return Promise.resolve();
        }),
      },
    };
    const prisma = {
      property: { findUnique: jest.fn(() => Promise.resolve(current)) },
      $transaction: (work: (t: typeof tx) => Promise<unknown>) => work(tx),
    };
    places = {
      isConfigured: true,
      findNearest: jest.fn((category: string) =>
        Promise.resolve(
          category === 'market'
            ? [
                {
                  providerPlaceId: 'm-far',
                  name: 'Phsar Far',
                  location: { lat: 11.56, lng: 104.92 },
                },
                {
                  providerPlaceId: 'm-near',
                  name: 'Phsar Near',
                  location: { lat: 11.555, lng: 104.92 },
                },
              ]
            : [
                {
                  providerPlaceId: 's-1',
                  name: 'Hun Sen School',
                  location: { lat: 11.551, lng: 104.92 },
                },
              ],
        ),
      ),
    } as never;
    routes = {
      isConfigured: true,
      // In request order: Phsar Far, Phsar Near, the school.
      roadDistances: jest.fn(() =>
        Promise.resolve([
          { meters: 2500, seconds: 420 },
          { meters: 900, seconds: 180 },
          null,
        ]),
      ),
    } as never;
    publicCache = { changed: jest.fn(), detailChanged: jest.fn() };
    service = new PropertyNearbyService(
      prisma as never,
      places,
      routes,
      publicCache as never,
    );
  });

  it('stores the nearest places of each tagged category, closest by road first', async () => {
    await service.refresh('p-1');

    expect(places.findNearest).toHaveBeenCalledTimes(2);
    expect(places.findNearest).toHaveBeenCalledWith('market', HOME, 5000, 3);
    expect(routes.roadDistances).toHaveBeenCalledTimes(1);
    expect(written.created).toEqual([
      expect.objectContaining({
        category: 'market',
        rank: 0,
        name: 'Phsar Near',
        roadMeters: 900,
        driveSeconds: 180,
      }),
      expect.objectContaining({
        category: 'market',
        rank: 1,
        name: 'Phsar Far',
        roadMeters: 2500,
      }),
      // No road found: kept, with its straight-line distance only.
      expect.objectContaining({
        category: 'school',
        rank: 0,
        roadMeters: null,
        straightMeters: 111,
      }),
    ]);
    expect(written.searchedAt).toBeInstanceOf(Date);
    // Only the listing's own page shows them.
    expect(publicCache.detailChanged).toHaveBeenCalledWith('p-1');
    expect(publicCache.changed).not.toHaveBeenCalled();
  });

  it('records "nothing within 5 km" as a search with no places', async () => {
    places.findNearest.mockResolvedValue([]);

    await service.refresh('p-1');

    expect(written.created).toEqual([]);
    expect(written.deleted).toBe(1);
    expect(written.searchedAt).toBeInstanceOf(Date);
    expect(routes.roadDistances).not.toHaveBeenCalled();
  });

  it('still stores the places when road distances fail', async () => {
    routes.roadDistances.mockRejectedValue(
      new Error('Routes API answered 403'),
    );

    await service.refresh('p-1');

    expect(written.created).toHaveLength(3);
    expect(
      written.created.every(
        (row) => (row as { roadMeters: null }).roadMeters === null,
      ),
    ).toBe(true);
  });

  it('clears the places once no basic-needs keyword is left, without calling the provider', async () => {
    current = listing(['road_access']);

    await service.refresh('p-1');

    expect(places.findNearest).not.toHaveBeenCalled();
    expect(written.deleted).toBe(1);
    expect(written.searchedAt).toBeNull();
  });

  it('waits for a location before looking anything up', async () => {
    current = listing(['near_market'], null);

    await service.refresh('p-1');

    expect(places.findNearest).not.toHaveBeenCalled();
    expect(written.deleted).toBe(0);
  });

  it('looks nothing up without credentials', async () => {
    (places as { isConfigured: boolean }).isConfigured = false;

    await service.refresh('p-1');

    expect(places.findNearest).not.toHaveBeenCalled();
    expect(written.deleted).toBe(0);
  });

  it('drops its result when the listing was re-tagged while it looked', async () => {
    places.findNearest.mockImplementation(async () => {
      current = listing(['near_hospital']);
      return [];
    });

    await service.refresh('p-1');

    expect(written.deleted).toBe(0);
    expect(publicCache.detailChanged).not.toHaveBeenCalled();
  });

  it('looks again after an edit only when the asked categories changed', () => {
    const refresh = jest.spyOn(service, 'refresh').mockResolvedValue();

    service.keywordsChanged(
      'p-1',
      ['near_market', 'road_access'],
      ['near_market', 'corner_land'],
    );
    expect(refresh).not.toHaveBeenCalled();

    service.keywordsChanged(
      'p-1',
      ['near_market'],
      ['near_market', 'near_hospital'],
    );
    expect(refresh).toHaveBeenCalledWith('p-1');
  });
});
