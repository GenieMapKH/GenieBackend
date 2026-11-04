import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional } from 'class-validator';
import { PageQuery } from './page.query';

/** The statuses an owner's listings can be filtered by (deleted ones never show). */
export const OWN_LISTING_STATUSES = [
  'Draft',
  'Pending',
  'Active',
  'Expired',
  'Sold',
] as const;
export type OwnListingStatus = (typeof OWN_LISTING_STATUSES)[number];

/**
 * One page of the user's own listings; with `status` (comma-separated, such
 * as `Draft,Expired`) only those in one of them: a My Properties tab.
 */
export class OwnListingsPageQuery extends PageQuery {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  @IsArray()
  @ArrayMaxSize(OWN_LISTING_STATUSES.length)
  @IsIn(OWN_LISTING_STATUSES, { each: true })
  @IsOptional()
  status?: OwnListingStatus[];
}
