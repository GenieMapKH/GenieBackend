import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { FIELDS_BY_TYPE, TYPE_SPECIFIC_FIELDS } from './property-type-fields';
import { toCreateData, toUpdateData } from './property-write-data';

const condo: CreatePropertyDto = {
  title: 'Riverside condo',
  price: 120000,
  propertyType: 'Condo',
  listingType: 'Sale',
  titleType: 'Hard Title',
  unitSize: 72,
  floorNumber: 12,
  floors: 30,
  bedrooms: 2,
  bathrooms: 2,
  hasBalcony: true,
  furnishing: 'Fully Furnished',
  completionStatus: 'Completed',
  viewType: 'River View',
  maintenanceFee: 80,
  keywords: ['near_market', 'water_supply'],
};

describe('toCreateData', () => {
  it('stores every detail of the type, the keywords and the owner', () => {
    const data = toCreateData('owner-1', condo);

    expect(data).toMatchObject({
      userId: 'owner-1',
      status: 'Draft',
      listingType: 'Sale',
      titleType: 'Hard Title',
      floorNumber: 12,
      hasBalcony: true,
      viewType: 'River View',
      maintenanceFee: 80,
      keywords: {
        create: [{ keyword: 'near_market' }, { keyword: 'water_supply' }],
      },
    });
  });

  it('drops details another type would have, even when the app sends them', () => {
    const data = toCreateData('owner-1', {
      ...condo,
      propertyType: 'Land',
      landSize: 400,
    });

    expect(data.landSize).toBe(400);
    expect(data.bedrooms).toBeNull();
    expect(data.hasBalcony).toBeNull();
    // Shared by every type: kept.
    expect(data.listingType).toBe('Sale');
    expect(data.titleType).toBe('Hard Title');
  });

  it('writes no keyword rows when none were picked', () => {
    expect(
      toCreateData('owner-1', { ...condo, keywords: [] }),
    ).not.toHaveProperty('keywords');
    expect(
      toCreateData('owner-1', { ...condo, keywords: undefined }),
    ).not.toHaveProperty('keywords');
  });
});

describe('toUpdateData', () => {
  it('replaces the keywords when a list is sent, and leaves them alone when not', () => {
    expect(
      toUpdateData({ keywords: ['corner_land'] }, 'Land').keywords,
    ).toEqual({
      deleteMany: {},
      create: [{ keyword: 'corner_land' }],
    });
    expect(toUpdateData({ keywords: [] }, 'Land').keywords).toEqual({
      deleteMany: {},
      create: [],
    });
    expect(toUpdateData({ title: 'New title' }, 'Land')).not.toHaveProperty(
      'keywords',
    );
  });

  it('clears what the old type had when the type changes', () => {
    const data = toUpdateData({ propertyType: 'Land', landSize: 500 }, 'Condo');

    expect(data.landSize).toBe(500);
    expect(data.unitSize).toBeNull();
    expect(data.floorNumber).toBeNull();
    expect(data.maintenanceFee).toBeNull();
  });

  it('keeps a warehouse to its sizes, floors and parking, without rooms', () => {
    const data = toUpdateData(
      { bedrooms: 3, bathrooms: 2, furnishing: 'Fully Furnished', floors: 2 },
      'Warehouse',
    );

    expect(data.floors).toBe(2);
    expect(data.bedrooms).toBeNull();
    expect(data.bathrooms).toBeNull();
    expect(data.furnishing).toBeNull();
  });

  it('keeps the current type when none is sent', () => {
    const data = toUpdateData({ bedrooms: 3 }, 'House');

    expect(data.bedrooms).toBe(3);
    expect(data).not.toHaveProperty('landSize');
    expect(data.unitSize).toBeNull();
  });
});

describe('type fields', () => {
  it('lists only known details for every type', () => {
    for (const fields of Object.values(FIELDS_BY_TYPE)) {
      for (const field of fields) expect(TYPE_SPECIFIC_FIELDS).toContain(field);
    }
  });
});

describe('property DTOs', () => {
  const errorsOf = async (cls: new () => object, body: object) =>
    (await validate(plainToInstance(cls, body))).map((error) => error.property);

  it('accepts a complete listing', async () => {
    expect(await errorsOf(CreatePropertyDto, condo)).toEqual([]);
  });

  it.each([
    ['propertyType', { propertyType: 'Castle' }],
    ['listingType', { listingType: 'Auction' }],
    ['keywords', { keywords: ['swimming_pool'] }],
    ['keywords', { keywords: ['road_access', 'road_access'] }],
    ['bedrooms', { bedrooms: 2.5 }],
    ['price', { price: -1 }],
  ])('refuses a bad %s', async (field, change) => {
    expect(await errorsOf(CreatePropertyDto, { ...condo, ...change })).toEqual([
      field,
    ]);
  });

  it('lets an edit clear a detail but never the title, price or type', async () => {
    expect(
      await errorsOf(UpdatePropertyDto, { bedrooms: null, viewType: null }),
    ).toEqual([]);
    expect(
      await errorsOf(UpdatePropertyDto, {
        title: null,
        price: null,
        propertyType: null,
      }),
    ).toEqual(['title', 'price', 'propertyType']);
    expect(await errorsOf(UpdatePropertyDto, {})).toEqual([]);
  });
});
