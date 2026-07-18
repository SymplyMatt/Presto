import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ledgerEntryModel, walletModel } from '../database/models';
import { walletsController } from './wallets.controller';
import { walletsService } from './wallets.service';

@Module({
  imports: [SequelizeModule.forFeature([walletModel, ledgerEntryModel])],
  controllers: [walletsController],
  providers: [walletsService],
  exports: [walletsService],
})
export class walletsModule {}
