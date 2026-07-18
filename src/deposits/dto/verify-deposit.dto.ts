import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class verifyDepositDto {
  @ApiProperty({
    description: 'Payment processor reference returned when the deposit was initialized',
    example: 'dep-550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  @MinLength(1)
  reference: string;
}
