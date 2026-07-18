import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { randomUUID } from 'node:crypto';
import { Op, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { currency, ensureSafeMoney } from '../common/money';
import { recentTransactionCutoff, recentTransactionMessage } from '../common/recent-transaction';
import { ledgerEntryModel, transferModel, userModel, walletModel } from '../database/models';
import { notificationService } from '../notifications/notification.service';
import { walletsService } from '../wallets/wallets.service';
import { createTransferDto } from './dto/create-transfer.dto';

export interface transferView {
  id: string;
  amount: number;
  currency: string;
  status: string;
  description: string | null;
  createdAt: Date;
}

@Injectable()
export class transfersService {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(userModel) private readonly users: typeof userModel,
    @InjectModel(walletModel) private readonly walletRecords: typeof walletModel,
    @InjectModel(transferModel) private readonly transfers: typeof transferModel,
    @InjectModel(ledgerEntryModel) private readonly ledgerEntries: typeof ledgerEntryModel,
    private readonly wallets: walletsService,
    private readonly notifications: notificationService,
  ) {}

  async create(
    senderId: string,
    senderEmail: string,
    input: createTransferDto,
  ): Promise<transferView> {
    ensureSafeMoney(input.amount);
    const recipientUsername = input.recipientUsername.trim().toLowerCase();
    const recipient = await this.users.findOne({ where: { username: recipientUsername } });
    if (!recipient) {
      throw new NotFoundException('recipient not found');
    }
    if (recipient.id === senderId) {
      throw new BadRequestException('cannot transfer to your own wallet');
    }
    const recipientWallet = await this.walletRecords.findOne({ where: { userId: recipient.id } });
    if (!recipientWallet) {
      throw new NotFoundException('recipient wallet not found');
    }

    const senderWallet = await this.wallets.getByUserId(senderId);
    const transfer = await this.sequelize.transaction((transaction) =>
      this.completeTransfer(transaction, senderWallet.id, recipientWallet.id, input),
    );

    await Promise.all([
      this.wallets.invalidate(senderId),
      this.wallets.invalidate(recipient.id),
      this.notifications.notify(senderEmail, 'wallet.transfer.sent', {
        amount: input.amount,
        recipientUsername,
        transferId: transfer.id,
      }),
      this.notifications.notify(recipient.email, 'wallet.transfer.received', {
        amount: input.amount,
        transferId: transfer.id,
      }),
    ]);
    return this.toView(transfer);
  }

  async get(userId: string, id: string): Promise<transferView> {
    const wallet = await this.wallets.getByUserId(userId);
    const transfer = await this.transfers.findOne({
      where: {
        id,
        [Op.or]: [{ senderWalletId: wallet.id }, { receiverWalletId: wallet.id }],
      },
    });
    if (!transfer) {
      throw new NotFoundException('transfer not found');
    }
    return this.toView(transfer);
  }

  private async completeTransfer(
    transaction: Transaction,
    senderWalletId: string,
    receiverWalletId: string,
    input: createTransferDto,
  ): Promise<transferModel> {
    const lockedWallets = await this.walletRecords.findAll({
      where: { id: { [Op.in]: [senderWalletId, receiverWalletId] } },
      order: [['id', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const senderWallet = lockedWallets.find((wallet) => wallet.id === senderWalletId);
    const receiverWallet = lockedWallets.find((wallet) => wallet.id === receiverWalletId);
    if (!senderWallet || !receiverWallet) {
      throw new NotFoundException('wallet not found');
    }

    const recent = await this.transfers.findOne({
      where: {
        senderWalletId,
        receiverWalletId,
        amount: input.amount,
        createdAt: { [Op.gte]: recentTransactionCutoff() },
      },
      transaction,
    });
    if (recent) {
      throw new ConflictException(recentTransactionMessage);
    }

    const senderBalance = Number(senderWallet.balance);
    const receiverBalance = Number(receiverWallet.balance);
    if (senderBalance < input.amount) {
      throw new ConflictException('insufficient wallet balance');
    }

    senderWallet.balance = senderBalance - input.amount;
    receiverWallet.balance = receiverBalance + input.amount;
    const transfer = await this.transfers.create(
      {
        senderWalletId,
        receiverWalletId,
        amount: input.amount,
        currency,
        idempotencyKey: randomUUID(),
        status: 'completed',
        description: input.description ?? null,
      },
      { transaction },
    );
    await Promise.all([senderWallet.save({ transaction }), receiverWallet.save({ transaction })]);
    await this.ledgerEntries.bulkCreate(
      [
        {
          walletId: senderWallet.id,
          entryType: 'transferDebit',
          direction: 'debit',
          amount: input.amount,
          balanceAfter: Number(senderWallet.balance),
          referenceType: 'transfer',
          referenceId: transfer.id,
        },
        {
          walletId: receiverWallet.id,
          entryType: 'transferCredit',
          direction: 'credit',
          amount: input.amount,
          balanceAfter: Number(receiverWallet.balance),
          referenceType: 'transfer',
          referenceId: transfer.id,
        },
      ],
      { transaction },
    );
    return transfer;
  }

  private toView(transfer: transferModel): transferView {
    return {
      id: transfer.id,
      amount: Number(transfer.amount),
      currency: transfer.currency,
      status: transfer.status,
      description: transfer.description,
      createdAt: transfer.createdAt,
    };
  }
}
