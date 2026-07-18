import { BadRequestException } from '@nestjs/common';

export const currency = 'NGN';

export const ensureSafeMoney = (amount: number): void => {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new BadRequestException('amount must be a positive integer in kobo');
  }
};
