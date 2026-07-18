import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { randomUUID } from 'node:crypto';
import { Op, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { currency, ensureSafeMoney } from '../common/money';
import { recentTransactionCutoff, recentTransactionMessage } from '../common/recent-transaction';
import { ledgerEntryModel, walletModel, withdrawalModel } from '../database/models';
import { notificationService } from '../notifications/notification.service';
import { paymentProvider } from '../payments/payment-provider';
import { paymentProviderRegistry } from '../payments/payment-provider.registry';
import { walletsService } from '../wallets/wallets.service';
import { createWithdrawalDto } from './dto/create-withdrawal.dto';

export interface withdrawalView {
  id: string;
  amount: number;
  currency: string;
  bankCode: string;
  accountNumberLastFour: string;
  accountName: string;
  paymentProcessor: string;
  reference: string;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
}

@Injectable()
export class withdrawalsService {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(withdrawalModel) private readonly withdrawals: typeof withdrawalModel,
    @InjectModel(walletModel) private readonly walletRecords: typeof walletModel,
    @InjectModel(ledgerEntryModel) private readonly ledgerEntries: typeof ledgerEntryModel,
    private readonly wallets: walletsService,
    private readonly providers: paymentProviderRegistry,
    private readonly notifications: notificationService,
  ) {}

  async create(userId: string, email: string, input: createWithdrawalDto): Promise<withdrawalView> {
    ensureSafeMoney(input.amount);
    const wallet = await this.wallets.getByUserId(userId);
    const provider = await this.providers.getActive();
    const resolved = await provider.resolveAccount({
      accountNumber: input.accountNumber,
      bankCode: input.bankCode,
    });
    const providerReference = `wd-${randomUUID()}`;
    const withdrawal = await this.sequelize.transaction((transaction) =>
      this.reserve(transaction, wallet.id, provider, providerReference, input, resolved.accountName),
    );

    await Promise.all([
      this.wallets.invalidate(userId),
      this.notifications.notify(email, 'wallet.withdrawal.requested', {
        amount: input.amount,
        withdrawalId: withdrawal.id,
      }),
    ]);

    try {
      const initiated = await provider.initiateWithdrawal({
        amount: Number(withdrawal.amount),
        currency: withdrawal.currency,
        reference: providerReference,
        destination: {
          accountName: resolved.accountName,
          accountNumber: input.accountNumber,
          bankCode: input.bankCode,
        },
        reason: input.reason,
      });
      withdrawal.providerTransferCode = initiated.transferCode ?? null;
      withdrawal.status = 'processing';
      await withdrawal.save();
      return this.toView(withdrawal);
    } catch (error) {
      if (error instanceof BadGatewayException || error instanceof ServiceUnavailableException) {
        await this.refundRejectedWithdrawal(withdrawal.id);
        await this.wallets.invalidate(userId);
      }
      throw error;
    }
  }

  async get(userId: string, id: string): Promise<withdrawalView> {
    const wallet = await this.wallets.getByUserId(userId);
    const withdrawal = await this.withdrawals.findOne({ where: { id, walletId: wallet.id } });
    if (!withdrawal) {
      throw new NotFoundException('withdrawal not found');
    }
    return this.toView(withdrawal);
  }

  private async reserve(
    transaction: Transaction,
    walletId: string,
    provider: paymentProvider,
    providerReference: string,
    input: createWithdrawalDto,
    accountName: string,
  ): Promise<withdrawalModel> {
    const wallet = await this.walletRecords.findByPk(walletId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!wallet) {
      throw new NotFoundException('wallet not found');
    }
    const recent = await this.withdrawals.findOne({
      where: {
        walletId,
        amount: input.amount,
        bankCode: input.bankCode,
        accountNumberLastFour: input.accountNumber.slice(-4),
        createdAt: { [Op.gte]: recentTransactionCutoff() },
      },
      transaction,
    });
    if (recent) {
      throw new ConflictException(recentTransactionMessage);
    }

    const balance = Number(wallet.balance);
    if (balance < input.amount) {
      throw new ConflictException('insufficient wallet balance');
    }

    wallet.balance = balance - input.amount;
    const withdrawal = await this.withdrawals.create(
      {
        walletId,
        amount: input.amount,
        currency,
        bankCode: input.bankCode,
        accountNumberLastFour: input.accountNumber.slice(-4),
        accountName,
        recipientCode: null,
        providerName: provider.name,
        providerReference,
        idempotencyKey: randomUUID(),
        status: 'pending',
        reason: input.reason ?? null,
      },
      { transaction },
    );
    await wallet.save({ transaction });
    await this.ledgerEntries.create(
      {
        walletId,
        entryType: 'withdrawalDebit',
        direction: 'debit',
        amount: input.amount,
        balanceAfter: Number(wallet.balance),
        referenceType: 'withdrawal',
        referenceId: withdrawal.id,
        paymentProcessorName: provider.name,
      },
      { transaction },
    );
    return withdrawal;
  }

  private async refundRejectedWithdrawal(id: string): Promise<void> {
    await this.sequelize.transaction(async (transaction) => {
      const withdrawal = await this.withdrawals.findByPk(id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!withdrawal || withdrawal.status === 'failed') {
        return;
      }
      const wallet = await this.walletRecords.findByPk(withdrawal.walletId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!wallet) {
        throw new NotFoundException('wallet not found');
      }
      wallet.balance = Number(wallet.balance) + Number(withdrawal.amount);
      withdrawal.status = 'failed';
      await Promise.all([wallet.save({ transaction }), withdrawal.save({ transaction })]);
      await this.ledgerEntries.create(
        {
          walletId: wallet.id,
          entryType: 'withdrawalRefund',
          direction: 'credit',
          amount: Number(withdrawal.amount),
          balanceAfter: Number(wallet.balance),
          referenceType: 'withdrawal',
          referenceId: withdrawal.id,
          paymentProcessorName: withdrawal.providerName,
        },
        { transaction },
      );
    });
  }

  private toView(withdrawal: withdrawalModel): withdrawalView {
    return {
      id: withdrawal.id,
      amount: Number(withdrawal.amount),
      currency: withdrawal.currency,
      bankCode: withdrawal.bankCode,
      accountNumberLastFour: withdrawal.accountNumberLastFour,
      accountName: withdrawal.accountName,
      paymentProcessor: withdrawal.providerName,
      reference: withdrawal.providerReference,
      status: withdrawal.status,
      createdAt: withdrawal.createdAt,
      completedAt: withdrawal.completedAt,
    };
  }
}
