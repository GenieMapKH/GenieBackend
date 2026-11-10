import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';

/** Proof that the caller owns the account: the password, or a fresh Google sign-in. */
export class IdentityProofDto {
  @ApiPropertyOptional({
    description: 'The account password. Required unless `idToken` is sent.',
  })
  @ValidateIf((dto: IdentityProofDto) => !dto.idToken)
  @IsString()
  @IsNotEmpty({ message: 'Enter your password, or confirm with Google' })
  @MaxLength(200)
  password?: string;

  @ApiPropertyOptional({
    description:
      'Firebase ID token from signing in with Google within the last 5 minutes.',
  })
  @ValidateIf((dto: IdentityProofDto) => !dto.password)
  @IsString()
  @IsNotEmpty()
  idToken?: string;
}
