import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { KEYWORDS, LISTING_TYPES, PROPERTY_TYPES } from '../property-options';
import { MapFilter } from '../map-filter';
import { MAX_AREA, MAX_MONEY } from './numeric-limits';

/** `?x=a` and `?x=a&x=b` both arrive as a list. */
const asList = ({ value }: { value: unknown }) =>
  value == null ? undefined : Array.isArray(value) ? value : [value];

/** The map filter, sent as query-string values. */
export class MapFilterQuery {
  @IsIn(PROPERTY_TYPES)
  @IsOptional()
  propertyType?: string;

  /** One or more; older app builds send just one. */
  @Transform(asList)
  @IsArray()
  @IsIn(LISTING_TYPES, { each: true })
  @ArrayMaxSize(LISTING_TYPES.length)
  @IsOptional()
  listingType?: string[];

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

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MAX_AREA)
  @IsOptional()
  minSize?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(MAX_AREA)
  @IsOptional()
  maxSize?: number;

  @Transform(asList)
  @IsArray()
  @IsIn(KEYWORDS, { each: true })
  @ArrayMaxSize(KEYWORDS.length)
  @IsOptional()
  keyword?: string[];
}

/**
 * The filter part of a query, for the services. A function rather than a
 * method: queries combining this one with another (`IntersectionType`) get
 * its fields but not its methods.
 */
export function mapFilterOf(query: MapFilterQuery): MapFilter {
  return {
    propertyType: query.propertyType,
    listingTypes: query.listingType,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    minSize: query.minSize,
    maxSize: query.maxSize,
    keywords: query.keyword,
  };
}
