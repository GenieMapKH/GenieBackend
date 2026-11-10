import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MapSearchQuery } from './dto/map-search.query';
import { mapFilterKey, mapFilterWhere, withoutPrice } from './map-filter';
import { PRICE_HISTOGRAM_BARS, priceHistogram } from './map-price-histogram';

describe('mapFilterWhere', () => {
  it('asks for nothing when nothing is chosen', () => {
    expect(mapFilterWhere({})).toEqual({});
  });

  it('matches any of the listing types, a price range and every keyword', () => {
    expect(
      mapFilterWhere({
        listingTypes: ['Rent', 'To Let'],
        minPrice: 100,
        maxPrice: 900,
        keywords: ['road_access', 'water_supply'],
      }),
    ).toEqual({
      listingType: { in: ['Rent', 'To Let'] },
      price: { gte: 100, lte: 900 },
      AND: [
        { keywords: { some: { keyword: 'road_access' } } },
        { keywords: { some: { keyword: 'water_supply' } } },
      ],
    });
  });

  it('leaves an open end of a range open', () => {
    expect(mapFilterWhere({ minPrice: 100 }).price).toEqual({ gte: 100 });
    expect(mapFilterWhere({ maxPrice: 900 }).price).toEqual({ lte: 900 });
  });

  it('checks the size a card shows for each type', () => {
    expect(mapFilterWhere({ minSize: 50 }).OR).toEqual([
      {
        propertyType: { in: ['Land', 'Business for Sale'] },
        landSize: { gt: 0, gte: 50 },
      },
      {
        propertyType: { in: ['House', 'Building', 'Warehouse'] },
        buildingSize: { gt: 0, gte: 50 },
      },
      { propertyType: { in: ['Condo'] }, unitSize: { gt: 0, gte: 50 } },
      {
        propertyType: { in: ['Borey'] },
        totalProjectArea: { gt: 0, gte: 50 },
      },
    ]);
  });

  it('drops only the price for the histogram', () => {
    expect(
      withoutPrice({ propertyType: 'Land', minPrice: 1, maxPrice: 2 }),
    ).toEqual({ propertyType: 'Land' });
  });

  it('names a filter the same whatever order its lists are in', () => {
    expect(mapFilterKey({ keywords: ['b', 'a'] })).toBe(
      mapFilterKey({ keywords: ['a', 'b'] }),
    );
    expect(mapFilterKey({ minPrice: 1 })).not.toBe(
      mapFilterKey({ maxPrice: 1 }),
    );
  });
});

describe('MapSearchQuery', () => {
  const bounds = { minLat: 11, maxLat: 12, minLng: 104, maxLng: 105 };

  it('reads one listing type, as older apps send it, as a list', async () => {
    const query = plainToInstance(MapSearchQuery, {
      ...bounds,
      listingType: 'Sale',
    });
    expect(await validate(query)).toHaveLength(0);
    expect(query.filter().listingTypes).toEqual(['Sale']);
  });

  it('reads repeated values and numbers from the query string', async () => {
    const query = plainToInstance(MapSearchQuery, {
      ...bounds,
      listingType: ['Rent', 'To Let'],
      keyword: ['corner_land'],
      minPrice: '100',
      maxSize: '500.5',
    });
    expect(await validate(query)).toHaveLength(0);
    expect(query.filter()).toMatchObject({
      listingTypes: ['Rent', 'To Let'],
      keywords: ['corner_land'],
      minPrice: 100,
      maxSize: 500.5,
    });
  });
});

describe('priceHistogram', () => {
  it('spreads prices over equal bars and puts everything above the top in the last', () => {
    const counts = priceHistogram([0, 999, 1000, 59_999, 60_000, 1e9], 60_000);
    expect(counts).toHaveLength(PRICE_HISTOGRAM_BARS);
    expect(counts[0]).toBe(2);
    expect(counts[1]).toBe(1);
    expect(counts[PRICE_HISTOGRAM_BARS - 1]).toBe(3);
  });
});
