import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';

export class ExpiryReminderDto {
  @IsUUID() userId!: string;
  @IsIn(['listing', 'subscription']) kind!: 'listing' | 'subscription';
  @ValidateIf(
    (event: ExpiryReminderDto) =>
      event.kind === 'listing' || event.propertyId !== undefined,
  )
  @IsUUID()
  propertyId?: string;
  @IsOptional() @IsIn(['silver', 'gold', 'diamond']) tier?: string;
  @IsISO8601({ strict: true }) expiresAt!: string;
}
