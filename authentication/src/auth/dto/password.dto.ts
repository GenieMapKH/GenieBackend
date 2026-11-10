import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { BCRYPT_MAX_PASSWORD_BYTES, MaxBytes } from './max-bytes';

/** The first password of an account that signs in with Google. */
export class CreatePasswordDto {
  @ApiProperty({
    description:
      'Firebase ID token from signing in with Google within the last 5 minutes.',
  })
  @IsString()
  @IsNotEmpty()
  idToken!: string;

  @ApiProperty({ description: 'The password to set (min 8 characters)' })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(200)
  @MaxBytes(BCRYPT_MAX_PASSWORD_BYTES)
  newPassword!: string;
}

/** Asks for a token that proves the password was just typed (see `PasswordProofService`). */
export class PasswordProofDto {
  @ApiProperty({ description: 'The account password' })
  @IsString()
  @IsNotEmpty({ message: 'Enter your password' })
  @MaxLength(200)
  password!: string;
}
