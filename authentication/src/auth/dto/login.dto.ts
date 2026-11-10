import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EMAIL_MAX_LENGTH, normalizeEmailInput } from './normalize-email';
import {
  normalizePhoneInput,
  PHONE_NUMBER,
  PHONE_NUMBER_MESSAGE,
} from './phone-number';

export class LoginDto {
  @ApiPropertyOptional({
    description: 'User email address',
    example: 'user@example.com',
  })
  @ValidateIf((o: LoginDto) => !o.phone)
  @IsEmail({}, { message: 'Must be a valid email if phone is not provided' })
  @IsNotEmpty()
  @MaxLength(EMAIL_MAX_LENGTH)
  @Transform(normalizeEmailInput)
  email?: string;

  @ApiPropertyOptional({
    description:
      'Phone number, in any spelling registration accepts (`012 345 678`, `+85512345678`)',
    example: '012 345 678',
  })
  @ValidateIf((o: LoginDto) => !o.email)
  @Transform(normalizePhoneInput)
  @IsString()
  @IsNotEmpty({
    message: 'Must provide a valid phone if email is not provided',
  })
  @Matches(PHONE_NUMBER, { message: PHONE_NUMBER_MESSAGE })
  phone?: string;

  @ApiProperty({ description: 'User password', example: 'strongpassword123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;
}
