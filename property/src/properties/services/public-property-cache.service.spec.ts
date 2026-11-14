import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FakeRedis, fakeCache } from '@tilomnov/shared/testing';
import { ListingChanges } from './listing-changes.service';
import { PropertyEngagementCounts } from './property-engagement-counts.service';
import { PropertyLifecycleService } from './property-lifecycle.service';
import { MapBoundsQuery } from '../dto/map-bounds.query';
import { MapSearchQuery } from '../dto/map-search.query';
import {
  MAP_RESULT_LIMIT,
  PropertyQueryService,
} from './property-query.service';
import { PropertySearchService } from './property-search.service';
import {
  PublicPropertyCache,
  widenToGrid,
} from './public-property-cache.service';

const VIEWPORT = {
  minLat: 11.5512,
  maxLat: 11.5688,
  minLng: 104.9101,
  maxLng: 104.9299,
};

describe('widenToGrid', () => {
  it('never returns a smaller box than the viewport', () => {
    const box = widenToGrid(VIEWPORT);

    expect(box.minLat).toBeLessThanOrEqual(VIEWPORT.minLat);
    expect(box.maxLat).toBeGreaterThanOrEqual(VIEWPORT.maxLat);
    expect(box.minLng).toBeLessThanOrEqual(VIEWPORT.minLng);
    expect(box.maxLng).toBeGreaterThanOrEqual(VIEWPORT.maxLng);
    expect(box).toEqual({
      minLat: 11.55,
      maxLat: 11.57,
      minLng: 104.91,
      maxLng: 104.93,
    });
  });

  it('leaves a box already on the grid as it is, so snapping in the app costs nothing', () => {
    for (let step = -18000; step <= 18000; step++) {
      const degrees = step / 100;
      const box = {
        minLat: degrees,
        maxLat: degrees,
        minLng: degrees,
        maxLng: degrees,
      };
      expect(widenToGrid(box)).toEqual(box);
    }
  });

  it('gives nearby viewports the same box, also south of the equator and west of Greenwich', () => {
    const nudged = {
      minLat: 11.5519,
      maxLat: 11.5681,
      minLng: 104.9109,
      maxLng: 104.9291,
    };
    expect(widenToGrid(nudged)).toEqual(widenToGrid(VIEWPORT));

    expect(
      widenToGrid({
        minLat: -33.8712,
        maxLat: -33.8605,
        minLng: -70.6549,
        maxLng: -70.6401,
      }),
    ).toEqual({
      minLat: -33.88,
      maxLat: -33.86,
      minLng: -70.66,
      maxLng: -70.64,
    });
  });
});

describe('public property cache', () => {
  const propertyTable = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  };
  const viewTable = { findMany: jest.fn() };
  const prisma = {
    user: { findUnique: jest.fn() },
    property: propertyTable,
    propertyView: viewTable,
    $queryRaw: jest.fn(),
  };
  const listing = {
    id: 'p-1',
    userId: 'owner',
    title: 'Villa',
    status: 'Active',
    lat: 11.56,
    lng: 104.92,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
  let redis: FakeRedis;
  let publicCache: PublicPropertyCache;
  let query: PropertyQueryService;
  let lifecycle: PropertyLifecycleService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.user.findUnique.mockResolvedValue({
      phone: '+85512345678',
      phoneVerified: true,
    });
    redis = new FakeRedis();
    publicCache = new PublicPropertyCache(fakeCache(redis));
    const counts = new PropertyEngagementCounts(prisma as never);
    query = new PropertyQueryService(
      prisma as never,
      publicCache,
      counts,
      prisma as never,
    );
    lifecycle = new PropertyLifecycleService(
      prisma as never,
      query,
      {
        canPublish: () => true,
        canMarkSold: () => true,
        canRelist: () => true,
      },
      new ListingChanges(publicCache),
      { locationChanged: jest.fn(), keywordsChanged: jest.fn() } as never,
      counts,
      {
        publish: (_userId: string, write: (tx: unknown) => unknown) =>
          write(prisma),
      } as never,
    );
    propertyTable.findMany.mockResolvedValue([listing]);
    propertyTable.findFirst.mockResolvedValue(listing);
    propertyTable.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...listing, ...data }),
    );
    viewTable.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([]);
  });

  describe('map search', () => {
    it('asks the database once for people looking at the same area', async () => {
      const first = await query.searchMap(VIEWPORT);
      const second = await query.searchMap({ ...VIEWPORT, minLat: 11.5519 });

      expect(propertyTable.findMany).toHaveBeenCalledTimes(1);
      expect(second).toEqual(JSON.parse(JSON.stringify(first)));
    });

    it('searches the widened box, so the shared answer covers every viewport in it', async () => {
      await query.searchMap(VIEWPORT);

      expect(propertyTable.findMany.mock.calls[0][0].where).toEqual({
        status: 'Active',
        // Listings of a deactivated account are hidden until its owner signs in again.
        user: { deactivatedAt: null },
        lat: { gte: 11.55, lte: 11.57 },
        lng: { gte: 104.91, lte: 104.93 },
      });
    });

    it('returns at most the newest listings, however far the map is zoomed out', async () => {
      await query.searchMap({
        minLat: -60,
        maxLat: 70,
        minLng: -170,
        maxLng: 170,
      });

      const args = propertyTable.findMany.mock.calls[0][0];
      expect(args.take).toBe(MAP_RESULT_LIMIT);
      expect(args.orderBy).toEqual({ createdAt: 'desc' });
    });

    it('refuses bounds that are the wrong way round', async () => {
      await expect(
        query.searchMap({ ...VIEWPORT, minLat: 12, maxLat: 11 }),
      ).rejects.toThrow(BadRequestException);
      expect(propertyTable.findMany).not.toHaveBeenCalled();
    });

    it.each([
      ['a latitude past the pole', { minLat: -91 }],
      ['a longitude past the date line', { maxLng: 181 }],
      ['a value that is not a number', { minLat: 'abc' }],
    ])('rejects %s before any search', async (_case, change) => {
      const query = plainToInstance(MapBoundsQuery, { ...VIEWPORT, ...change });
      expect(await validate(query)).not.toHaveLength(0);
    });

    it('narrows the search to the filter pills, keeping the box', async () => {
      await query.searchMap(VIEWPORT, undefined, {
        propertyType: 'House',
        listingTypes: ['Rent'],
      });

      expect(propertyTable.findMany.mock.calls[0][0].where).toMatchObject({
        status: 'Active',
        propertyType: 'House',
        listingType: { in: ['Rent'] },
        lat: { gte: 11.55, lte: 11.57 },
      });
    });

    it('keeps one shared answer per filter, so a filtered map never shows unfiltered results', async () => {
      await query.searchMap(VIEWPORT);
      await query.searchMap(VIEWPORT, undefined, { propertyType: 'Land' });
      await query.searchMap(VIEWPORT, undefined, { listingTypes: ['Sale'] });
      await query.searchMap(VIEWPORT, undefined, { propertyType: 'Land' });

      expect(propertyTable.findMany).toHaveBeenCalledTimes(3);
    });

    it('counts the prices of the same search, ignoring its own price range', async () => {
      propertyTable.findMany.mockResolvedValue([
        { price: '1000' },
        { price: '99000' },
        { price: '250000' },
      ]);

      const { counts } = await query.priceHistogram(
        VIEWPORT,
        { listingTypes: ['Sale'], minPrice: 50_000, maxPrice: 60_000 },
        100_000,
      );

      const { where } = propertyTable.findMany.mock.calls[0][0];
      expect(where.price).toBeUndefined();
      expect(where.listingType).toEqual({ in: ['Sale'] });
      expect(counts[0]).toBe(1);
      expect(counts[counts.length - 1]).toBe(2);
    });

    it('keeps the histogram apart from the listings in the cache', async () => {
      await query.searchMap(VIEWPORT);
      await query.priceHistogram(VIEWPORT, {}, 100_000);
      await query.priceHistogram(VIEWPORT, {}, 100_000);

      expect(propertyTable.findMany).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['an unknown property type', { propertyType: 'Castle' }],
      ['an unknown listing type', { listingType: 'Auction' }],
      [
        'an unknown listing type among known ones',
        { listingType: ['Rent', 'Auction'] },
      ],
      ['an unknown keyword', { keyword: 'pool' }],
      ['a negative price', { minPrice: -1 }],
      ['a size that is not a number', { maxSize: 'big' }],
    ])('rejects %s in the map filter', async (_case, change) => {
      const search = plainToInstance(MapSearchQuery, {
        ...VIEWPORT,
        ...change,
      });
      expect(await validate(search)).not.toHaveLength(0);
    });

    it('looks up "visited" per user and never stores it in the shared answer', async () => {
      viewTable.findMany.mockResolvedValue([{ propertyId: 'p-1' }]);

      const forAlice = await query.searchMap(VIEWPORT, 'alice');
      const forGuest = await query.searchMap(VIEWPORT);

      expect(forAlice[0].isVisited).toBe(true);
      expect(forGuest[0].isVisited).toBe(false);
      expect(viewTable.findMany).toHaveBeenCalledTimes(1);
      expect([...redis.values.values()].join()).not.toContain('isVisited');
    });

    it('shows a newly published listing on the very next search', async () => {
      propertyTable.findMany.mockResolvedValue([]);
      expect(await query.searchMap(VIEWPORT)).toEqual([]);

      propertyTable.findFirst.mockResolvedValue({
        ...listing,
        status: 'Draft',
      });
      await lifecycle.publish('owner', 'p-1');
      propertyTable.findMany.mockResolvedValue([listing]);

      expect(await query.searchMap(VIEWPORT)).toHaveLength(1);
    });

    it('still answers from the database while Redis is down', async () => {
      redis.down = true;

      expect(await query.searchMap(VIEWPORT)).toHaveLength(1);
      expect(await query.searchMap(VIEWPORT)).toHaveLength(1);
      expect(propertyTable.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('outdated by area', () => {
    const siemReap = { ...listing, id: 'p-2', lat: 13.36, lng: 103.86 };
    const publishInSiemReap = async (owner = 'owner') => {
      propertyTable.findFirst.mockResolvedValue({
        ...siemReap,
        userId: owner,
        status: 'Draft',
      });
      propertyTable.update.mockResolvedValue({
        ...siemReap,
        userId: owner,
        status: 'Active',
      });
      await lifecycle.publish(owner, 'p-2');
    };

    it('keeps the map of one city cached when a listing elsewhere changes', async () => {
      await query.searchMap(VIEWPORT);
      await publishInSiemReap();
      await query.searchMap(VIEWPORT);

      expect(propertyTable.findMany).toHaveBeenCalledTimes(1);
    });

    it('stops showing a listing where it was, once it moved away', async () => {
      expect(await query.searchMap(VIEWPORT)).toHaveLength(1);

      propertyTable.update.mockResolvedValue({
        ...listing,
        lat: siemReap.lat,
        lng: siemReap.lng,
      });
      await lifecycle.updatePin('owner', 'p-1', {
        lat: siemReap.lat,
        lng: siemReap.lng,
      });
      propertyTable.findMany.mockResolvedValue([]);

      expect(await query.searchMap(VIEWPORT)).toEqual([]);
    });

    it('outdates a zoomed-out map with any change, wherever it is', async () => {
      const wholeCountry = {
        minLat: 10,
        maxLat: 14.7,
        minLng: 102.3,
        maxLng: 107.7,
      };
      await query.searchMap(wholeCountry);
      await publishInSiemReap();
      await query.searchMap(wholeCountry);

      expect(propertyTable.findMany).toHaveBeenCalledTimes(2);
    });

    it("outdates an owner's list with their own changes only", async () => {
      const search = new PropertySearchService(
        prisma as never,
        publicCache,
        new PropertyEngagementCounts(prisma as never),
      );
      await search.byOwner('owner', 100);

      await publishInSiemReap('someone-else');
      await search.byOwner('owner', 100);
      expect(propertyTable.findMany).toHaveBeenCalledTimes(1);

      await publishInSiemReap('owner');
      await search.byOwner('owner', 100);
      expect(propertyTable.findMany).toHaveBeenCalledTimes(2);
    });

    it('outdates text searches with any change', async () => {
      const search = new PropertySearchService(
        prisma as never,
        publicCache,
        new PropertyEngagementCounts(prisma as never),
      );
      await search.matching(['villa'], 8);
      await publishInSiemReap('someone-else');
      await search.matching(['villa'], 8);

      expect(propertyTable.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('listing page', () => {
    it('is read from the database once, then from the cache', async () => {
      await query.findPublic('p-1');
      await query.findPublic('p-1');

      expect(propertyTable.findFirst).toHaveBeenCalledTimes(1);
    });

    it('shows an edit at once, and disappears at once when unpublished', async () => {
      await query.findPublic('p-1');

      await lifecycle.update('owner', 'p-1', { title: 'Villa with pool' });
      propertyTable.findFirst.mockResolvedValue({
        ...listing,
        title: 'Villa with pool',
      });
      expect((await query.findPublic('p-1')).title).toBe('Villa with pool');

      await lifecycle.unpublish('owner', 'p-1');
      propertyTable.findFirst.mockResolvedValue(null);
      await expect(query.findPublic('p-1')).rejects.toThrow(NotFoundException);
    });

    it('does not remember that a listing was missing', async () => {
      propertyTable.findFirst.mockResolvedValue(null);
      await expect(query.findPublic('p-1')).rejects.toThrow(NotFoundException);

      propertyTable.findFirst.mockResolvedValue(listing);
      await expect(query.findPublic('p-1')).resolves.toBeDefined();
    });
  });

  it('checks an edited price against the discount already on the listing', async () => {
    propertyTable.findFirst.mockResolvedValue({
      ...listing,
      price: '100000',
      discountType: 'amount',
      discountValue: '20000',
    });

    await expect(
      lifecycle.update('owner', 'p-1', { price: 15000 }),
    ).rejects.toThrow('smaller than the price');
    await expect(
      lifecycle.update('owner', 'p-1', {
        price: 15000,
        discountType: null,
        discountValue: null,
      }),
    ).resolves.toBeDefined();
    await expect(
      lifecycle.update('owner', 'p-1', {
        discountType: 'percent',
        discountValue: 10,
      }),
    ).resolves.toBeDefined();
  });

  it('leaves the shared cache alone while a draft is being edited', async () => {
    await query.searchMap(VIEWPORT);
    propertyTable.findFirst.mockResolvedValue({ ...listing, status: 'Draft' });

    await lifecycle.update('owner', 'p-1', { title: 'Still a draft' });
    await lifecycle.updatePin('owner', 'p-1', { lat: 11.56, lng: 104.92 });
    await query.searchMap(VIEWPORT);

    expect(propertyTable.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('public detail invalidation during a read', () => {
  it('cannot restore an obsolete listing after it is withdrawn', async () => {
    const cache = new PublicPropertyCache(fakeCache());
    let finish!: (value: string) => void;
    const oldRead = cache.detail(
      'p',
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    await cache.changed({ id: 'p', userId: 'owner', lat: 11.55, lng: 104.92 });
    finish('old active details');
    await oldRead;
    expect(await cache.detail('p', async () => 'unavailable')).toBe(
      'unavailable',
    );
  });
});
