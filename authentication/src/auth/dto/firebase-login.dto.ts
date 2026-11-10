import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class FirebaseLoginDto {
  @ApiProperty({
    description: 'Firebase ID token received from the client SDK',
  })
  @IsString()
  @IsNotEmpty()
  idToken!: string;
}
