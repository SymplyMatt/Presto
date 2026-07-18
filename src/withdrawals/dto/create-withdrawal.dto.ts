import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class createWithdrawalDto {
  @ApiProperty({ description: 'Amount in kobo', example: 100000 })
  @IsInt()
  @Min(1)
  @Max(1_000_000_000_000)
  amount: number;

  @ApiProperty({ example: '058' })
  @Matches(/^\d{3,10}$/)
  bankCode: string;

  @ApiProperty({ example: '0123456789' })
  @Matches(/^\d{10}$/)
  accountNumber: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  accountName: string;

  @ApiProperty({ required: false, example: 'Personal withdrawal' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  reason?: string;
}
