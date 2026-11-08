import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { EMAIL_MAX_LENGTH, normalizeEmailInput } from './normalize-email';

/** An email for an account that has none, confirmed with the account password. */
export class AddEmailDto {
  @ApiProperty({ example: 'user@example.com' })
  @Transform(normalizeEmailInput)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @ApiProperty({ description: 'The account password' })
  @IsString()
  @IsNotEmpty({ message: 'Enter your password' })
  @MaxLength(200)
  password!: string;

  @IsString()
  @MaxLength(4096)
  emailProof!: string;
}
