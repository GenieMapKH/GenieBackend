import { Transform } from 'class-transformer';
import { E164_PHONE_NUMBER, normalizePhoneNumber } from '@tilomnov/shared';
import {
  ArrayMaxSize,
  Matches,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsObject,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TakeoverDto } from './takeover.dto';
import {
  BUILDING_TYPES,
  COMPLETION_STATUSES,
  DISCOUNT_TYPES,
  FURNISHINGS,
  KEYWORDS,
  LISTING_TYPES,
  MAX_KEYWORDS,
  PROJECT_TYPES,
  PROPERTY_TYPES,
  TITLE_TYPES,
  VIEW_TYPES,
} from '../property-options';
import { MAX_AREA, MAX_COUNT, MAX_MONEY } from './numeric-limits';

/** The statuses a listing can be created with. Later changes go through their own endpoints. */
const CREATE_STATUSES = ['Draft', 'Active'] as const;

/**
 * A new listing. Every detail is optional here: a draft may be saved half
 * filled. Details that do not belong to `propertyType` are dropped by the
 * service (see property-type-fields.ts).
 */
export class CreatePropertyDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => TakeoverDto)
  takeover?: TakeoverDto | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsString()
  @IsOptional()
  @MaxLength(5000)
  description?: string;

  @IsNumber()
  @Min(0)
  @Max(MAX_MONEY)
  price: number;

  @IsIn(PROPERTY_TYPES)
  propertyType: string;

  /** With `discountValue`: a percentage of the price, or USD off it. */
  @IsIn(DISCOUNT_TYPES)
  @IsOptional()
  discountType?: string | null;

  @IsNumber()
  @IsOptional()
  @Max(MAX_MONEY)
  discountValue?: number | null;

  @IsIn(LISTING_TYPES)
  @IsOptional()
  listingType?: string;

  @IsIn(TITLE_TYPES)
  @IsOptional()
  titleType?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim()
      ? (normalizePhoneNumber(value) ?? value)
      : value,
  )
  @Matches(E164_PHONE_NUMBER)
  contactPhone?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @ArrayUnique()
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((number: unknown) =>
          typeof number === 'string'
            ? (normalizePhoneNumber(number) ?? number)
            : number,
        )
      : value,
  )
  @IsString({ each: true })
  @Matches(E164_PHONE_NUMBER, { each: true })
  additionalContactPhones?: string[];

  @IsInt()
  @Min(0)
  @IsOptional()
  @Max(MAX_COUNT)
  bedrooms?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  @Max(MAX_COUNT)
  bathrooms?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Max(MAX_AREA)
  landSize?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Max(MAX_AREA)
  buildingSize?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Max(MAX_AREA)
  unitSize?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Max(MAX_AREA)
  totalProjectArea?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  @Max(MAX_COUNT)
  floors?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  @Max(MAX_COUNT)
  floorNumber?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  @Max(MAX_COUNT)
  totalUnits?: number;

  @IsBoolean()
  @IsOptional()
  hasParking?: boolean;

  @IsBoolean()
  @IsOptional()
  hasBalcony?: boolean;

  @IsIn(FURNISHINGS)
  @IsOptional()
  furnishing?: string;

  @IsIn(BUILDING_TYPES)
  @IsOptional()
  buildingType?: string;

  @IsIn(COMPLETION_STATUSES)
  @IsOptional()
  completionStatus?: string;

  @IsIn(VIEW_TYPES)
  @IsOptional()
  viewType?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Max(MAX_MONEY)
  maintenanceFee?: number;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  developerName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  projectName?: string;

  @IsIn(PROJECT_TYPES)
  @IsOptional()
  projectType?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Max(MAX_MONEY)
  monthlyRent?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  @Max(MAX_COUNT)
  leaseRemainingMonths?: number;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  equipmentIncluded?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  reasonForSelling?: string;

  /** Keyword codes (see KEYWORDS). On update, the list replaces the old one. */
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(MAX_KEYWORDS)
  @IsIn(KEYWORDS, { each: true })
  @IsOptional()
  keywords?: string[];

  /** `Active` publishes at once (what the app sends); anything else starts as a draft. */
  @IsIn(CREATE_STATUSES)
  @IsOptional()
  status?: string;
}
