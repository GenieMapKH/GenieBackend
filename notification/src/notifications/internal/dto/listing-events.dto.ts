import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** The most people one call may name; the property service sends more in several calls. */
export const MAX_RECIPIENTS = 500;

/** A title long enough to recognise; a push shows less anyway. */
const MAX_TITLE_LENGTH = 200;

/** One person whose saved search a listing matched. */
export class SavedSearchRecipientDto {
  @IsUUID()
  userId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  searchName: string;
}

/** From property: a listing went live that these people's saved searches would show. */
export class SavedSearchMatchEventDto {
  @IsUUID()
  propertyId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TITLE_LENGTH)
  title: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RECIPIENTS)
  @ValidateNested({ each: true })
  @Type(() => SavedSearchRecipientDto)
  recipients: SavedSearchRecipientDto[];
}

/** The people to tell: at least one, at most [MAX_RECIPIENTS] per call. */
class ListingRecipientsDto {
  @IsUUID()
  propertyId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TITLE_LENGTH)
  title: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RECIPIENTS)
  @IsUUID('all', { each: true })
  recipients: string[];
}

/** From property: someone these people follow posted a listing. */
export class FollowedListingEventDto extends ListingRecipientsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  ownerName: string;
}

/** From property: a listing these people saved dropped its price, or was sold. */
export class SavedListingUpdateEventDto extends ListingRecipientsDto {
  @IsIn(['price_drop', 'sold'])
  kind: 'price_drop' | 'sold';

  /** USD, what a buyer paid before and pays now; for a price drop only. */
  @ValidateIf(
    (event: SavedListingUpdateEventDto) => event.kind === 'price_drop',
  )
  @IsNumber()
  @Min(0)
  from?: number;

  @ValidateIf(
    (event: SavedListingUpdateEventDto) => event.kind === 'price_drop',
  )
  @IsNumber()
  @Min(0)
  to?: number;
}
