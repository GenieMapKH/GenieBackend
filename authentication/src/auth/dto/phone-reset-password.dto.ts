import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { BCRYPT_MAX_PASSWORD_BYTES, MaxBytes } from './max-bytes';

/** A Firebase ID token is a little over a kilobyte; far more is not one. */
const MAX_ID_TOKEN_LENGTH = 4096;

/** "Forgot password" for a phone number, proven by an SMS code (see `PhonePasswordResetService`). */
export class PhoneResetPasswordDto {
  @ApiProperty({
    description:
      'Firebase ID token from confirming an SMS code within the last 5 minutes. It names the phone number.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_ID_TOKEN_LENGTH)
  idToken!: string;

  @ApiProperty({ example: 'newSecurePassword123' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxBytes(BCRYPT_MAX_PASSWORD_BYTES)
  newPassword!: string;
}
