import { ApiPropertyOptional } from '@nestjs/swagger';
import { E164_PHONE_NUMBER, normalizePhoneNumber } from '@tilomnov/shared';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/** A handle: 3 to 30 lowercase letters, digits, "_" or ".". */
export const USERNAME_PATTERN = /^[a-z0-9_.]{3,30}$/;

/** The values the `users.sex` column accepts. */
export const SEXES = ['male', 'female', 'other'] as const;
export type Sex = (typeof SEXES)[number];

/** Surrounding spaces never count; an empty text field means "not set". */
function trimToNull({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** One stored spelling per number, as at sign-up; a number it cannot read is left for `@Matches` to refuse. */
function toPhoneNumber({ value }: { value: unknown }): unknown {
  return typeof value === 'string'
    ? (normalizePhoneNumber(value) ?? value)
    : value;
}

function toLowerCase({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

/**
 * Every field is optional: only the ones sent are changed. Sending `null`
 * (or an empty string) clears a field, except `username` and `phone`, which
 * stay once set.
 * The profile picture has its own endpoints (`AvatarService`).
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: 'Unique handle: 3-30 lowercase letters, digits, "_" or "."',
  })
  @ValidateIf((dto: UpdateProfileDto) => dto.username !== undefined)
  @Transform(toLowerCase)
  @Matches(USERNAME_PATTERN, {
    message:
      'Username must be 3-30 characters: lowercase letters, numbers, "_" or "."',
  })
  username?: string;

  @ApiPropertyOptional({
    description: 'The name shown to other people. Does not have to be unique.',
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(60)
  name?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(50)
  firstName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(50)
  lastName?: string | null;

  @ApiPropertyOptional({ enum: SEXES })
  @IsOptional()
  @IsIn(SEXES)
  sex?: Sex | null;

  @ApiPropertyOptional({
    description:
      'The new phone number. Without a country code it is read as Cambodian; stored as E.164. Cannot be cleared: it is how phone-only accounts sign in.',
  })
  @ValidateIf((dto: UpdateProfileDto) => dto.phone !== undefined)
  @Transform(toPhoneNumber)
  @IsString()
  @Matches(E164_PHONE_NUMBER, {
    message: 'Enter a valid phone number, for example 012 345 678',
  })
  phone?: string;
}
