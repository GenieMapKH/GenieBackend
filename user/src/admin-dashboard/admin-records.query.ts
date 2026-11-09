import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const ADMIN_SECTIONS = [
  'active-users',
  'all-users',
  'new-users',
  'active-listings',
  'all-listings',
  'new-listings',
  'reports',
  'leads',
  'subscriptions',
  'successful-payments',
  'pending-payments',
] as const;

export class AdminRecordsQuery {
  @IsIn(ADMIN_SECTIONS)
  section: (typeof ADMIN_SECTIONS)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  offset = 0;

  @IsOptional()
  @IsIn(['silver', 'gold', 'diamond'])
  tier?: string;
}
