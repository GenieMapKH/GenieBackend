import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** A Firebase registration token is about 160 characters; this leaves room without accepting junk. */
const MAX_TOKEN_LENGTH = 4096;

/** `POST /notifications/devices`: this device can be reached with `token`. */
export class RegisterPushDeviceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TOKEN_LENGTH)
  token: string;

  @IsIn(['android', 'ios', 'web'])
  platform: 'android' | 'ios' | 'web';

  /** The app's language; notifications are written in it. English when missing. */
  @IsOptional()
  @IsIn(['en', 'km'])
  locale?: 'en' | 'km';
}

/** `POST /notifications/devices/remove`: stop pushes to this device. */
export class RemovePushDeviceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TOKEN_LENGTH)
  token: string;
}
