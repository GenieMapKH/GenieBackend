import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BoundaryDto } from './boundary.dto';
import { CreatePropertyDto } from './create-property.dto';
import { PinDto } from './pin.dto';
import { UpdatePropertyDto } from './update-property.dto';

const valid = { title: 'House', price: 1000, propertyType: 'House' };

function errorsOf<T extends object>(dto: new () => T, plain: object): string[] {
  return validateSync(plainToInstance(dto, plain), { whitelist: true }).map(
    (e) => e.property,
  );
}

describe('CreatePropertyDto limits', () => {
  it('accepts a listing as the app sends it', () => {
    expect(errorsOf(CreatePropertyDto, { ...valid, status: 'Active' })).toEqual(
      [],
    );
  });

  it.each(['Sold', 'Deleted', 'anything-else'])(
    'refuses status %s on create',
    (status) => {
      expect(errorsOf(CreatePropertyDto, { ...valid, status })).toEqual([
        'status',
      ]);
    },
  );

  it('refuses a price the column cannot hold', () => {
    expect(errorsOf(CreatePropertyDto, { ...valid, price: 1e10 })).toEqual([
      'price',
    ]);
  });

  it('accepts the largest price the column holds', () => {
    expect(
      errorsOf(CreatePropertyDto, { ...valid, price: 9_999_999_999.99 }),
    ).toEqual([]);
  });

  it('refuses an area, a count and a discount that are too big', () => {
    const errors = errorsOf(CreatePropertyDto, {
      ...valid,
      landSize: 1e8,
      bedrooms: 3_000_000_000,
      discountType: 'amount',
      discountValue: 1e10,
    });
    expect(errors.sort()).toEqual(['bedrooms', 'discountValue', 'landSize']);
  });
});

describe('UpdatePropertyDto limits', () => {
  it('refuses a price the column cannot hold', () => {
    expect(errorsOf(UpdatePropertyDto, { price: 1e10 })).toEqual(['price']);
  });
});

describe('PinDto', () => {
  it('accepts a point on Earth', () => {
    expect(errorsOf(PinDto, { lat: 11.55, lng: 104.9 })).toEqual([]);
  });

  it.each([
    { lat: 91, lng: 0 },
    { lat: 0, lng: -181 },
  ])('refuses %j', (pin) => {
    expect(errorsOf(PinDto, pin)).toHaveLength(1);
  });
});

describe('BoundaryDto', () => {
  it('accepts a list of points, and an empty list', () => {
    expect(
      errorsOf(BoundaryDto, { boundaryPoints: [{ lat: 1, lng: 2 }] }),
    ).toEqual([]);
    expect(errorsOf(BoundaryDto, { boundaryPoints: [] })).toEqual([]);
  });

  it('refuses points that are not coordinates', () => {
    expect(
      errorsOf(BoundaryDto, { boundaryPoints: [{ lat: 'a' }, null, 5] }),
    ).toEqual(['boundaryPoints']);
  });

  it('refuses a boundary with thousands of points', () => {
    const points = Array.from({ length: 501 }, () => ({ lat: 1, lng: 2 }));
    expect(errorsOf(BoundaryDto, { boundaryPoints: points })).toEqual([
      'boundaryPoints',
    ]);
  });
});
