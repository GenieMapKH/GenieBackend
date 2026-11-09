import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class AdminLoginStartDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

export class AdminLoginCompleteDto {
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  token!: string;
}
