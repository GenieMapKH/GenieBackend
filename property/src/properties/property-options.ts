/**
 * The values the add-property form offers, as the app sends them. Anything
 * else is refused by the DTOs, so filters can rely on exact matches.
 */
export const PROPERTY_TYPES = [
  'Land',
  'House',
  'Warehouse',
  'Building',
  'Condo',
  'Borey',
  'Business for Sale',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const TAKEOVER_LISTING_TYPE = 'Takeover Payments';
export const LISTING_TYPES = [
  'Sale',
  'Rent',
  'To Let',
  TAKEOVER_LISTING_TYPE,
] as const;

/** A discount is a percentage of the price, or an amount (USD) off it. */
export const DISCOUNT_TYPES = ['percent', 'amount'] as const;

export const TITLE_TYPES = ['Hard Title', 'Soft Title', 'Other'] as const;

export const FURNISHINGS = [
  'Unfurnished',
  'Fully Furnished',
  'Electrical appliances',
] as const;

export const BUILDING_TYPES = [
  'Commercial Building',
  'Office Building',
  'Mixed-use',
  'Retail Building',
  'Warehouse',
] as const;

/** Condos use the first three; Borey projects the whole list. */
export const COMPLETION_STATUSES = [
  'Off-plan',
  'Pre-launch',
  'Under Construction',
  '50% Completed',
  '80% Completed',
  'Completed',
] as const;

export const VIEW_TYPES = [
  'City View',
  'River View',
  'Garden View',
  'Pool View',
  'No View',
] as const;

export const PROJECT_TYPES = [
  'Borey',
  'Condo',
  'Commercial',
  'Mixed-use',
  'Land Subdivision',
] as const;

/** Mirrors the rows of the `keywords` table (migration 14). */
export const KEYWORDS = [
  'road_access',
  'corner_land',
  'near_market',
  'near_school',
  'near_hospital',
  'river_lake_nearby',
  'electricity_ready',
  'water_supply',
  'residential_area',
  'commercial_area',
] as const;

/** The most keywords one listing can carry: every one there is. */
export const MAX_KEYWORDS = KEYWORDS.length;
