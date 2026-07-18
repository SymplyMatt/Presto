import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ledgerEntryModel, walletModel, withdrawalModel } from '../database/models';
import { paymentsModule } from '../payments/payments.module';
import { walletsModule } from '../wallets/wallets.module';
import { withdrawalsController } from './withdrawals.controller';
import { withdrawalsService } from './withdrawals.service';

@Module({
  imports: [
    SequelizeModule.forFeature([withdrawalModel, walletModel, ledgerEntryModel]),
    paymentsModule,
    walletsModule,
  ],
  controllers: [withdrawalsController],
  providers: [withdrawalsService],
})
export class withdrawalsModule {}
