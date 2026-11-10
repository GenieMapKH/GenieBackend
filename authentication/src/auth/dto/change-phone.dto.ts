import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import { IdentityProofDto } from './identity-proof.dto';
import {
  normalizePhoneInput,
  PHONE_NUMBER,
  PHONE_NUMBER_MESSAGE,
} from './phone-number';

export class ChangePhoneDto extends IdentityProofDto {
  @Transform(normalizePhoneInput)
  @IsString()
  @Matches(PHONE_NUMBER, { message: PHONE_NUMBER_MESSAGE })
  phone!: string;
}
