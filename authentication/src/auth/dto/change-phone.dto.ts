import { IsString, MaxLength } from 'class-validator';
import { IdentityProofDto } from './identity-proof.dto';

export class ChangePhoneDto extends IdentityProofDto {
  @IsString()
  @MaxLength(10000)
  phoneToken!: string;
}
