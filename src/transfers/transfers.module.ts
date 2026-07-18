import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ledgerEntryModel, transferModel, userModel, walletModel } from '../database/models';
import { walletsModule } from '../wallets/wallets.module';
import { transfersController } from './transfers.controller';
import { transfersService } from './transfers.service';

@Module({
  imports: [
    SequelizeModule.forFeature([transferModel, userModel, walletModel, ledgerEntryModel]),
    walletsModule,
  ],
  controllers: [transfersController],
  providers: [transfersService],
})
export class transfersModule {}
