import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { FakeRedis, fakeCache } from '@tilomnov/shared/testing';
import { ClosestListingsQuery } from '../dto/closest-listings.query';
import { ClosestListingsService } from './closest-listings.service';
import { PublicPropertyCache } from './public-property-cache.service';

const ORIGIN = { lat: 11.5564, lng: 104.9282 };

/** Listing `n` is `n` hundredths of a degree north of the origin. */
const positions = [3, 1, 4, 2, 5].map((n) => ({
  id: `p-${n}`,
  lat: ORIGIN.lat + n / 100,
  lng: ORIGIN.lng,
}));

describe('ClosestListingsService', () => {
  let findMany: jest.Mock;
  let service: ClosestListingsService;

  beforeEach(() => {
    findMany = jest.fn(
      (args: { select: { title?: true }; where: { id?: { in: string[] } } }) =>
        Promise.resolve(
          // The ranking read selects positions only; the card read asks by id.
          args.where.id
            ? args.where.id.in.map((id) => ({ id, title: `Listing ${id}` }))
            : positions,
        ),
    );
    service = new ClosestListingsService(
      { property: { findMany } } as never,
      new PublicPropertyCache(fakeCache(new FakeRedis())),
      { attach: jest.fn((rows) => Promise.resolve(rows)) } as never,
    );
  });

  it('pages the listings nearest first, each with its distance', async () => {
    const first = await service.page(ORIGIN, {}, { limit: 2, offset: 0 });
    expect(first.items.map((i) => i.id)).toEqual(['p-1', 'p-2']);
    expect(first.items[0].distanceMeters).toBeGreaterThan(1000);
    expect(first.items[0].distanceMeters).toBeLessThan(1200);
    expect(first.nextOffset).toBe(2);

    const last = await service.page(ORIGIN, {}, { limit: 2, offset: 4 });
    expect(last.items.map((i) => i.id)).toEqual(['p-5']);
    expect(last.nextOffset).toBeNull();
  });

  it('ranks from cached positions on the next page', async () => {
    await service.page(ORIGIN, {}, { limit: 2, offset: 0 });
    await service.page(ORIGIN, {}, { limit: 2, offset: 2 });

    const positionReads = findMany.mock.calls.filter(
      ([args]) => !args.where.id,
    );
    expect(positionReads).toHaveLength(1);
  });

  it('reads only published, placed listings passing the filter', async () => {
    await service.page(
      ORIGIN,
      { propertyType: 'Land' },
      { limit: 2, offset: 0 },
    );

    const [args] = findMany.mock.calls[0];
    expect(args.where).toMatchObject({
      status: 'Active',
      propertyType: 'Land',
      lat: { not: null },
      lng: { not: null },
    });
  });

  it('leaves out a listing unpublished since it was ranked', async () => {
    findMany.mockImplementation((args) =>
      Promise.resolve(
        args.where.id
          ? args.where.id.in
              .filter((id: string) => id !== 'p-1')
              .map((id: string) => ({ id }))
          : positions,
      ),
    );
    const page = await service.page(ORIGIN, {}, { limit: 2, offset: 0 });
    expect(page.items.map((i) => i.id)).toEqual(['p-2']);
    expect(page.nextOffset).toBe(2);
  });

  it('answers an empty page when nothing is published', async () => {
    findMany.mockResolvedValue([]);
    const page = await service.page(ORIGIN, {}, { limit: 20, offset: 0 });
    expect(page).toEqual({ items: [], nextOffset: null });
  });
});

describe('ClosestListingsQuery', () => {
  const errorsOf = (plain: Record<string, unknown>) =>
    validateSync(plainToInstance(ClosestListingsQuery, plain)).map(
      (e) => e.property,
    );

  it('reads the point, the page and the filter from the query string', () => {
    const query = plainToInstance(ClosestListingsQuery, {
      lat: '11.55',
      lng: '104.92',
      limit: '20',
      offset: '40',
      listingType: 'Rent',
      keyword: ['road_access', 'corner_land'],
    });
    expect(validateSync(query)).toEqual([]);
    expect(query.lat).toBe(11.55);
    expect(query.offset).toBe(40);
    expect(query.filter()).toMatchObject({
      listingTypes: ['Rent'],
      keywords: ['road_access', 'corner_land'],
    });
  });

  it('refuses a missing or impossible point and an oversized page', () => {
    expect(errorsOf({ lng: '104.9' })).toContain('lat');
    expect(errorsOf({ lat: '91', lng: '104.9' })).toContain('lat');
    expect(errorsOf({ lat: '11', lng: '104', limit: '500' })).toContain(
      'limit',
    );
  });
});
