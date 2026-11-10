import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_MONEY } from './numeric-limits';

export const TAKEOVER_PROVIDERS = ['Developer', 'Bank'] as const;
export const PAYMENT_FREQUENCIES = ['Monthly', 'Quarterly', 'Yearly'] as const;
export const INTEREST_TYPES = ['None', 'Fixed', 'Variable', 'Unknown'] as const;
export const TRANSFER_STATUSES = [
  'Not checked',
  'Conditional',
  'Written approval',
  'Not allowed',
] as const;
export const COST_PAYERS = ['Buyer', 'Seller', 'Shared', 'Unknown'] as const;

class AdditionalPaymentDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(MAX_MONEY)
  amount?: number | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  dueDate?: string | null;
}

/** Fields may be incomplete in a draft; going live checks the whole agreement. */
export class TakeoverDto {
  @IsOptional()
  @IsIn(TAKEOVER_PROVIDERS)
  providerType?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  providerName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  projectName?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_MONEY)
  sellerAmount?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_MONEY)
  remainingBalance?: number | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  balanceAsOf?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_MONEY)
  paymentAmount?: number | null;

  @IsOptional()
  @IsIn(PAYMENT_FREQUENCIES)
  paymentFrequency?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1200)
  remainingMonths?: number | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  nextPaymentDate?: string | null;

  @IsOptional()
  @IsIn(INTEREST_TYPES)
  interestType?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  annualInterestRate?: number | null;

  @IsOptional()
  @IsIn(TRANSFER_STATUSES)
  transferStatus?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_MONEY)
  transferFee?: number | null;

  @IsOptional()
  @IsIn(COST_PAYERS)
  transferFeePayer?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_MONEY)
  arrearsAmount?: number | null;

  @IsOptional()
  @IsIn(COST_PAYERS)
  arrearsPayer?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => AdditionalPaymentDto)
  additionalPayments: AdditionalPaymentDto[];

  @IsOptional()
  @IsBoolean()
  hasAdditionalPayments?: boolean | null;
}
