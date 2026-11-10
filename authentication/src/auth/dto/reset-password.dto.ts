import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { BCRYPT_MAX_PASSWORD_BYTES, MaxBytes } from './max-bytes';
import { normalizeEmailInput } from './normalize-email';

export class ResetPasswordDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  @Transform(normalizeEmailInput)
  email!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  otp!: string;

  @ApiProperty({ example: 'newSecurePassword123' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxBytes(BCRYPT_MAX_PASSWORD_BYTES)
  newPassword!: string;
}
