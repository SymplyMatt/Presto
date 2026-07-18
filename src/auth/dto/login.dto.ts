import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class loginDto {
  @ApiProperty({ description: 'Email address or username', example: 'ada_lovelace' })
  @IsString()
  @MaxLength(254)
  identifier: string;

  @ApiProperty({ example: 'correct horse battery staple' })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}
