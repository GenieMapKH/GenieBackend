import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MapBoundsQuery } from '../../properties/dto/map-bounds.query';
import { MAX_AREA, MAX_MONEY } from '../../properties/dto/numeric-limits';
import {
  KEYWORDS,
  LISTING_TYPES,
  PROPERTY_TYPES,
} from '../../properties/property-options';

/** What the list shows: short enough for a push title. */
export const MAX_NAME_LENGTH = 60;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * `POST /search/saved`: the map area and filter as the map sends them
 * (`GET /public/properties/map`), plus a name. Body numbers, not query
 * strings, so no conversion.
 */
export class CreateSavedSearchDto extends MapBoundsQuery {
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  name: string;

  @IsOptional()
  @IsIn(PROPERTY_TYPES)
  propertyType?: string;

  @IsOptional()
  @IsArray()
  @IsIn(LISTING_TYPES, { each: true })
  @ArrayMaxSize(LISTING_TYPES.length)
  listingTypes?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  minPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  maxPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_AREA)
  minSize?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_AREA)
  maxSize?: number;

  @IsOptional()
  @IsArray()
  @IsIn(KEYWORDS, { each: true })
  @ArrayMaxSize(KEYWORDS.length)
  keywords?: string[];

  /** Push when a new listing matches. On unless said otherwise. */
  @IsOptional()
  @IsBoolean()
  alerts?: boolean;
}

/** `PATCH /search/saved/:id`: rename it, or turn its alerts on or off. */
export class UpdateSavedSearchDto {
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;

  @IsOptional()
  @IsBoolean()
  alerts?: boolean;
}
