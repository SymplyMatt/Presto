import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { depositModel, walletModel } from '../database/models';
import { paymentsModule } from '../payments/payments.module';
import { walletsModule } from '../wallets/wallets.module';
import { depositExpireProcessor } from './deposit-expire.processor';
import { depositsController } from './deposits.controller';
import { depositExpireQueue, depositsService } from './deposits.service';

const queueDisabled = process.env.DISABLE_QUEUE_WORKER === 'true';
const queueImports = queueDisabled ? [] : [BullModule.registerQueue({ name: depositExpireQueue })];
const queueProviders = queueDisabled
  ? [depositsService]
  : [depositsService, depositExpireProcessor];

@Module({
  imports: [
    SequelizeModule.forFeature([depositModel, walletModel]),
    paymentsModule,
    walletsModule,
    ...queueImports,
  ],
  controllers: [depositsController],
  providers: queueProviders,
  exports: [depositsService],
})
export class depositsModule {}
