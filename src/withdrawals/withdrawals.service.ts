import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { randomUUID } from 'node:crypto';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { currency, ensureSafeMoney } from '../common/money';
import { ledgerEntryModel, walletModel, withdrawalModel } from '../database/models';
import { notificationService } from '../notifications/notification.service';
import { paymentProvider } from '../payments/payment-provider';
import { paymentProviderRegistry } from '../payments/payment-provider.registry';
import { walletsService } from '../wallets/wallets.service';
import { createWithdrawalDto } from './dto/create-withdrawal.dto';

interface reservedWithdrawal {
  withdrawal: withdrawalModel;
  replayed: boolean;
}

export interface withdrawalView {
  id: string;
  amount: number;
  currency: string;
  bankCode: string;
  accountNumberLastFour: string;
  accountName: string;
  provider: string;
  reference: string;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  replayed: boolean;
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

  async create(
    userId: string,
    email: string,
    key: string,
    input: createWithdrawalDto,
  ): Promise<withdrawalView> {
    ensureSafeMoney(input.amount);
    const wallet = await this.wallets.getByUserId(userId);
    const existing = await this.withdrawals.findOne({
      where: { walletId: wallet.id, idempotencyKey: key },
    });
    if (existing) {
      return this.toView(existing, true);
    }

    const provider = this.providers.getActive();
    const recipientCode = await provider.createWithdrawalRecipient({
      accountName: input.accountName.trim(),
      accountNumber: input.accountNumber,
      bankCode: input.bankCode,
      currency,
    });
    const providerReference = `wd-${randomUUID()}`;
    const result = await this.sequelize.transaction((transaction) =>
      this.reserve(transaction, wallet.id, key, provider, providerReference, recipientCode, input),
    );
    if (result.replayed) {
      return this.toView(result.withdrawal, true);
    }

    await Promise.all([
      this.wallets.invalidate(userId),
      this.notifications.notify(email, 'wallet.withdrawal.requested', {
        amount: input.amount,
        withdrawalId: result.withdrawal.id,
      }),
    ]);

    try {
      const initiated = await provider.initiateWithdrawal({
        amount: Number(result.withdrawal.amount),
        currency: result.withdrawal.currency,
        recipientCode,
        reference: providerReference,
        reason: input.reason,
      });
      result.withdrawal.providerTransferCode = initiated.transferCode ?? null;
      result.withdrawal.status = 'processing';
      await result.withdrawal.save();
      return this.toView(result.withdrawal, false);
    } catch (error) {
      if (error instanceof BadGatewayException) {
        await this.refundRejectedWithdrawal(result.withdrawal.id);
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
    return this.toView(withdrawal, false);
  }

  private async reserve(
    transaction: Transaction,
    walletId: string,
    key: string,
    provider: paymentProvider,
    providerReference: string,
    recipientCode: string,
    input: createWithdrawalDto,
  ): Promise<reservedWithdrawal> {
    const wallet = await this.walletRecords.findByPk(walletId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!wallet) {
      throw new NotFoundException('wallet not found');
    }
    const existing = await this.withdrawals.findOne({
      where: { walletId, idempotencyKey: key },
      transaction,
    });
    if (existing) {
      return { withdrawal: existing, replayed: true };
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
        accountName: input.accountName.trim(),
        recipientCode,
        providerName: provider.name,
        providerReference,
        idempotencyKey: key,
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
      },
      { transaction },
    );
    return { withdrawal, replayed: false };
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
        },
        { transaction },
      );
    });
  }

  private toView(withdrawal: withdrawalModel, replayed: boolean): withdrawalView {
    return {
      id: withdrawal.id,
      amount: Number(withdrawal.amount),
      currency: withdrawal.currency,
      bankCode: withdrawal.bankCode,
      accountNumberLastFour: withdrawal.accountNumberLastFour,
      accountName: withdrawal.accountName,
      provider: withdrawal.providerName,
      reference: withdrawal.providerReference,
      status: withdrawal.status,
      createdAt: withdrawal.createdAt,
      completedAt: withdrawal.completedAt,
      replayed,
    };
  }
}
