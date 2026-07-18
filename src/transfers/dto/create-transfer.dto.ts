import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class createTransferDto {
  @ApiProperty({ example: 'grace_hopper' })
  @Matches(/^[a-zA-Z0-9_]{3,30}$/)
  recipientUsername: string;

  @ApiProperty({ description: 'Amount in kobo', example: 250000 })
  @IsInt()
  @Min(1)
  @Max(1_000_000_000_000)
  amount: number;

  @ApiProperty({ required: false, example: 'Lunch reimbursement' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  description?: string;
}
