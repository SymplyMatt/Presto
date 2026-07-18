import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import {
  depositModel,
  ledgerEntryModel,
  userModel,
  walletModel,
  webhookEventModel,
  withdrawalModel,
} from '../database/models';
import { paymentsModule } from '../payments/payments.module';
import { walletsModule } from '../wallets/wallets.module';
import { webhooksController } from './webhooks.controller';
import { webhooksService } from './webhooks.service';

@Module({
  imports: [
    SequelizeModule.forFeature([
      webhookEventModel,
      depositModel,
      withdrawalModel,
      walletModel,
      ledgerEntryModel,
      userModel,
    ]),
    paymentsModule,
    walletsModule,
  ],
  controllers: [webhooksController],
  providers: [webhooksService],
})
export class webhooksModule {}
