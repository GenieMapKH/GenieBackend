import { Prisma } from '@tilomnov/prisma-client';

export const FEED_SORTS = ['newest', 'top', 'priceLow', 'priceHigh'] as const;
export type FeedSort = (typeof FEED_SORTS)[number];

export interface FeedFilters {
  sort?: FeedSort;
  since?: string;
  until?: string;
  propertyType?: string;
  minPrice?: number;
  maxPrice?: number;
}

/** Same discounted buyer price as properties/price-drop.ts. */
export const FEED_PRICE = Prisma.sql`CASE
  WHEN discount_value > 0 AND discount_type = 'percent'
    THEN price * (1 - discount_value / 100)
  WHEN discount_value > 0 AND discount_type = 'amount'
    THEN GREATEST(0, price - discount_value)
  ELSE price END`;

export function feedConditions(filter: FeedFilters): Prisma.Sql {
  return Prisma.sql`
    ${filter.since ? Prisma.sql`AND published_at >= ${new Date(filter.since)}` : Prisma.empty}
    ${filter.until ? Prisma.sql`AND published_at < ${new Date(filter.until)}` : Prisma.empty}
    ${filter.propertyType ? Prisma.sql`AND property_type = ${filter.propertyType}` : Prisma.empty}
    ${filter.minPrice !== undefined ? Prisma.sql`AND (${FEED_PRICE}) >= ${filter.minPrice}` : Prisma.empty}
    ${filter.maxPrice !== undefined ? Prisma.sql`AND (${FEED_PRICE}) <= ${filter.maxPrice}` : Prisma.empty}`;
}
