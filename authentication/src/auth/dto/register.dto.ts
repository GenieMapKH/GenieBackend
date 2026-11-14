import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BCRYPT_MAX_PASSWORD_BYTES, MaxBytes } from './max-bytes';
import {
  EMAIL_MAX_LENGTH,
  normalizeOptionalEmailInput,
} from './normalize-email';
import {
  normalizePhoneInput,
  PHONE_NUMBER,
  PHONE_NUMBER_MESSAGE,
} from './phone-number';

/** No control characters and no "<" or ">": a name is never markup. */
const DISPLAY_NAME = /^[^\p{Cc}<>]*$/u;

/** Surrounding spaces never count; left blank means "not given". */
function trimToUndefined({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * A phone number with SMS ownership proof is required;
 * an email supplied with a phone can be verified later in account settings.
 */
export class RegisterDto {
  @ApiProperty({
    description:
      'Phone number. Without a country code it is read as Cambodian; stored as E.164.',
    example: '012 345 678',
  })
  @Transform((input: { value: unknown }) =>
    normalizePhoneInput({ value: trimToUndefined(input) }),
  )
  @IsString({ message: PHONE_NUMBER_MESSAGE })
  @Matches(PHONE_NUMBER, { message: PHONE_NUMBER_MESSAGE })
  phone!: string;

  @ApiPropertyOptional({
    description: 'Email address. Optional; blank means none.',
    example: 'user@example.com',
  })
  @IsOptional()
  @Transform(normalizeOptionalEmailInput)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(EMAIL_MAX_LENGTH)
  email?: string;

  @ApiPropertyOptional({
    description: 'The name shown to other people (at most 60 characters)',
    example: 'Sok Dara',
  })
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(60)
  @Matches(DISPLAY_NAME, { message: 'Name contains characters not allowed' })
  name?: string;

  @ApiProperty({
    description: 'User password (min 8 characters)',
    example: 'strongpassword123',
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxBytes(BCRYPT_MAX_PASSWORD_BYTES)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  emailProof?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8192)
  phoneProof?: string;
}
