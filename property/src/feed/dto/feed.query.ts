import { Type } from 'class-transformer';
import {
  IsInt,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_PAGE_SIZE } from '../../properties/dto/page.query';
import { MAX_MONEY } from '../../properties/dto/numeric-limits';
import { PROPERTY_TYPES } from '../../properties/property-options';
import { FEED_SORTS, FeedSort } from '../feed-filters';

/** One page of the feed: `limit` listings after `cursor` (from the start without one). */
export class FeedQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  @IsOptional()
  limit?: number;

  /** `nextCursor` of the page before, exactly as received. */
  @IsString()
  @MaxLength(200)
  @IsOptional()
  cursor?: string;

  @IsIn(FEED_SORTS)
  @IsOptional()
  sort?: FeedSort;

  @IsISO8601({ strict: true })
  @IsOptional()
  since?: string;

  /** Exclusive upper bound, so a selected end date includes the entire day. */
  @IsISO8601({ strict: true })
  @IsOptional()
  until?: string;

  @IsIn(PROPERTY_TYPES)
  @IsOptional()
  propertyType?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  @IsOptional()
  minPrice?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  @IsOptional()
  maxPrice?: number;
}
