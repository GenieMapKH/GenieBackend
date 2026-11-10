import { Prisma } from '@tilomnov/prisma-client';

import { PropertyType } from './property-options';
import { SIZE_FIELD_BY_TYPE, SizeField } from './property-type-fields';

/** What the map filter narrows the listings to; unset means any. */
export interface MapFilter {
  propertyType?: string;
  /** Any of these, e.g. Rent and To Let together for "For rent". */
  listingTypes?: string[];
  /** USD, on the asking price (before any discount); inclusive. */
  minPrice?: number;
  maxPrice?: number;
  /** m², on the size a card shows for the type (`SIZE_FIELD_BY_TYPE`). */
  minSize?: number;
  maxSize?: number;
  /** The listing carries every one of these. */
  keywords?: string[];
}

/** The filter without its price, for the price histogram of the same search. */
export function withoutPrice(filter: MapFilter): MapFilter {
  const { minPrice: _min, maxPrice: _max, ...rest } = filter;
  return rest;
}

/** A Prisma `where` for the listings that pass `filter`. */
export function mapFilterWhere(filter: MapFilter): Prisma.PropertyWhereInput {
  const where: Prisma.PropertyWhereInput = {};
  if (filter.propertyType) where.propertyType = filter.propertyType;
  if (filter.listingTypes?.length) {
    where.listingType = { in: filter.listingTypes };
  }
  const price = range(filter.minPrice, filter.maxPrice);
  if (price) where.price = price;
  const size = range(filter.minSize, filter.maxSize);
  if (size) where.OR = sizeIn(size);
  if (filter.keywords?.length) {
    where.AND = filter.keywords.map((keyword) => ({
      keywords: { some: { keyword } },
    }));
  }
  return where;
}

/** One cache name per filter: the same filter in any order gives the same name. */
export function mapFilterKey(filter: MapFilter): string {
  const list = (values?: string[]) => [...(values ?? [])].sort().join(',');
  return [
    filter.propertyType ?? '',
    list(filter.listingTypes),
    filter.minPrice ?? '',
    filter.maxPrice ?? '',
    filter.minSize ?? '',
    filter.maxSize ?? '',
    list(filter.keywords),
  ].join(':');
}

type Range = { gte?: number; lte?: number };

function range(min?: number, max?: number): Range | null {
  if (min == null && max == null) return null;
  return {
    ...(min != null && { gte: min }),
    ...(max != null && { lte: max }),
  };
}

/** The size a listing's type shows on its cards is in `size`. */
function sizeIn(size: Range): Prisma.PropertyWhereInput[] {
  const typesBySize = new Map<SizeField, PropertyType[]>();
  for (const [type, field] of Object.entries(SIZE_FIELD_BY_TYPE)) {
    typesBySize.set(field, [
      ...(typesBySize.get(field) ?? []),
      type as PropertyType,
    ]);
  }
  return [...typesBySize].map(([field, types]) => ({
    propertyType: { in: types },
    [field]: { gt: 0, ...size },
  }));
}
