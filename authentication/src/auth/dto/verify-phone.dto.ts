import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import {
  normalizePhoneInput,
  PHONE_NUMBER,
  PHONE_NUMBER_MESSAGE,
} from './phone-number';

export class VerifyPhoneDto {
  @Transform(normalizePhoneInput)
  @IsString()
  @Matches(PHONE_NUMBER, { message: PHONE_NUMBER_MESSAGE })
  phone!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(8192)
  phoneProof!: string;
}
