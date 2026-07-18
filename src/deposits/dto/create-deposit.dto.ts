import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class createDepositDto {
  @ApiProperty({ description: 'Amount in kobo', example: 500000 })
  @IsInt()
  @Min(100)
  @Max(1_000_000_000_000)
  amount: number;
}
