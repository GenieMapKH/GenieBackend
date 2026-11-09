import { IsString, IsUUID, Matches } from 'class-validator';
export const AD_PATH =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class AdUploadDto {
  @IsUUID() actorId: string;
}
export class CreateAdDto extends AdUploadDto {
  @IsString() @Matches(AD_PATH) path: string;
}
