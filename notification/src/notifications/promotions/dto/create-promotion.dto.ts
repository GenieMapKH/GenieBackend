import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from 'class-validator';

/** Longer than this is cut off by most phones anyway. */
const MAX_TITLE_LENGTH = 65;
const MAX_BODY_LENGTH = 240;
const MAX_URL_LENGTH = 2048;
const HTTPS_ONLY = { protocols: ['https'], require_protocol: true };

/**
 * `POST /notifications/promotions` (admins only). English is required; the
 * Khmer text is used for devices set to Khmer when given.
 */
export class CreatePromotionDto {
  /** Chosen by the sender to make a retried request safe: one id is sent once. */
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TITLE_LENGTH)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_BODY_LENGTH)
  body: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TITLE_LENGTH)
  titleKm?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_BODY_LENGTH)
  bodyKm?: string;

  /** Tapping the notification opens this listing... */
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  /** ...or else this web page. */
  @IsOptional()
  @IsUrl(HTTPS_ONLY)
  @MaxLength(MAX_URL_LENGTH)
  url?: string;

  /** A picture shown in the notification where the phone supports it. */
  @IsOptional()
  @IsUrl(HTTPS_ONLY)
  @MaxLength(MAX_URL_LENGTH)
  imageUrl?: string;
}
