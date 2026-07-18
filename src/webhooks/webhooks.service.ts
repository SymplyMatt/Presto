import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  depositModel,
  ledgerEntryModel,
  userModel,
  walletModel,
  webhookEventModel,
  withdrawalModel,
} from '../database/models';
import { notificationService } from '../notifications/notification.service';
import { paymentProvider, providerWebhookEvent } from '../payments/payment-provider';
import { paymentProviderRegistry } from '../payments/payment-provider.registry';
import { walletsService } from '../wallets/wallets.service';

export interface webhookResult {
  processed: boolean;
  duplicate: boolean;
  reason?: string;
  userId?: string;
  email?: string;
  activity?: string;
  details?: Record<string, unknown>;
}

@Injectable()
export class webhooksService {
  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(depositModel) private readonly deposits: typeof depositModel,
    @InjectModel(withdrawalModel) private readonly withdrawals: typeof withdrawalModel,
    @InjectModel(walletModel) private readonly walletRecords: typeof walletModel,
    @InjectModel(ledgerEntryModel) private readonly ledgerEntries: typeof ledgerEntryModel,
    @InjectModel(userModel) private readonly users: typeof userModel,
    @InjectModel(webhookEventModel) private readonly webhookEvents: typeof webhookEventModel,
    private readonly providers: paymentProviderRegistry,
    private readonly wallets: walletsService,
    private readonly notifications: notificationService,
  ) {}

  async handle(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<Omit<webhookResult, 'userId' | 'email' | 'activity' | 'details'>> {
    const provider = await this.providers.getActive();
    const event = provider.verifyAndParseWebhook(rawBody, headers);
    const result = await this.routeEvent(provider, event);

    if (result.userId) {
      await this.wallets.invalidate(result.userId);
    }
    if (result.email && result.activity) {
      await this.notifications.notify(result.email, result.activity, result.details ?? {});
    }
    return {
      processed: result.processed,
      duplicate: result.duplicate,
      reason: result.reason,
    };
  }

  private routeEvent(provider: paymentProvider, event: providerWebhookEvent) {
    if (event.type === 'depositSucceeded') {
      return this.processDeposit(provider.name, event);
    }
    if (event.type === 'withdrawalSucceeded' || event.type === 'withdrawalFailed') {
      return this.processWithdrawal(provider.name, event);
    }
    return this.recordIgnored(provider.name, event);
  }

  private processDeposit(providerName: string, event: providerWebhookEvent) {
    return this.sequelize.transaction(async (transaction): Promise<webhookResult> => {
      const deposit = event.reference
        ? await this.deposits.findOne({
            where: { providerName, providerReference: event.reference },
            transaction,
            lock: transaction.LOCK.UPDATE,
          })
        : null;
      if (!deposit) {
        await this.recordEvent(transaction, providerName, event, 'ignored');
        return { processed: false, duplicate: false, reason: 'deposit not found' };
      }

      const duplicate = await this.eventExists(transaction, providerName, event.eventId);
      if (duplicate || deposit.status === 'confirmed') {
        if (!duplicate) {
          await this.recordEvent(transaction, providerName, event, 'duplicate');
        }
        return { processed: false, duplicate: true };
      }
      if (deposit.status !== 'pending' && deposit.status !== 'failed') {
        await this.recordEvent(transaction, providerName, event, 'ignored');
        return { processed: false, duplicate: false, reason: 'deposit not eligible for credit' };
      }
      if (event.amount !== Number(deposit.amount) || event.currency !== deposit.currency) {
        await this.recordEvent(transaction, providerName, event, 'rejected');
        return { processed: false, duplicate: false, reason: 'deposit details do not match' };
      }

      const wallet = await this.walletRecords.findByPk(deposit.walletId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!wallet) {
        throw new NotFoundException('wallet not found');
      }
      wallet.balance = Number(wallet.balance) + Number(deposit.amount);
      deposit.status = 'confirmed';
      deposit.confirmedAt = new Date();
      await Promise.all([wallet.save({ transaction }), deposit.save({ transaction })]);
      await this.ledgerEntries.create(
        {
          walletId: wallet.id,
          entryType: 'depositCredit',
          direction: 'credit',
          amount: Number(deposit.amount),
          balanceAfter: Number(wallet.balance),
          referenceType: 'deposit',
          referenceId: deposit.id,
          paymentProcessorName: providerName,
        },
        { transaction },
      );
      await this.recordEvent(transaction, providerName, event, 'processed');
      const user = await this.users.findByPk(wallet.userId, { transaction });
      if (!user) {
        throw new NotFoundException('user not found');
      }
      return {
        processed: true,
        duplicate: false,
        userId: user.id,
        email: user.email,
        activity: 'wallet.deposit.confirmed',
        details: { amount: Number(deposit.amount), depositId: deposit.id },
      };
    });
  }

  private processWithdrawal(providerName: string, event: providerWebhookEvent) {
    return this.sequelize.transaction(async (transaction): Promise<webhookResult> => {
      const withdrawal = event.reference
        ? await this.withdrawals.findOne({
            where: { providerName, providerReference: event.reference },
            transaction,
            lock: transaction.LOCK.UPDATE,
          })
        : null;
      if (!withdrawal) {
        await this.recordEvent(transaction, providerName, event, 'ignored');
        return { processed: false, duplicate: false, reason: 'withdrawal not found' };
      }
      if (await this.eventExists(transaction, providerName, event.eventId)) {
        return { processed: false, duplicate: true };
      }

      const wallet = await this.walletRecords.findByPk(withdrawal.walletId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!wallet) {
        throw new NotFoundException('wallet not found');
      }
      const user = await this.users.findByPk(wallet.userId, { transaction });
      if (!user) {
        throw new NotFoundException('user not found');
      }
      if (event.type === 'withdrawalSucceeded') {
        return this.completeWithdrawal(transaction, providerName, event, withdrawal, user);
      }
      return this.failWithdrawal(transaction, providerName, event, withdrawal, wallet, user);
    });
  }

  private async completeWithdrawal(
    transaction: Transaction,
    providerName: string,
    event: providerWebhookEvent,
    withdrawal: withdrawalModel,
    user: userModel,
  ): Promise<webhookResult> {
    if (withdrawal.status === 'completed') {
      await this.recordEvent(transaction, providerName, event, 'duplicate');
      return { processed: false, duplicate: true };
    }
    if (withdrawal.status === 'failed') {
      withdrawal.status = 'manualReview';
      await withdrawal.save({ transaction });
      await this.recordEvent(transaction, providerName, event, 'manualReview');
      return { processed: false, duplicate: false, reason: 'conflicting provider outcome' };
    }
    withdrawal.status = 'completed';
    withdrawal.completedAt = new Date();
    await withdrawal.save({ transaction });
    await this.recordEvent(transaction, providerName, event, 'processed');
    return {
      processed: true,
      duplicate: false,
      userId: user.id,
      email: user.email,
      activity: 'wallet.withdrawal.completed',
      details: { amount: Number(withdrawal.amount), withdrawalId: withdrawal.id },
    };
  }

  private async failWithdrawal(
    transaction: Transaction,
    providerName: string,
    event: providerWebhookEvent,
    withdrawal: withdrawalModel,
    wallet: walletModel,
    user: userModel,
  ): Promise<webhookResult> {
    if (withdrawal.status === 'failed') {
      await this.recordEvent(transaction, providerName, event, 'duplicate');
      return { processed: false, duplicate: true };
    }
    if (withdrawal.status === 'completed') {
      withdrawal.status = 'manualReview';
      await withdrawal.save({ transaction });
      await this.recordEvent(transaction, providerName, event, 'manualReview');
      return { processed: false, duplicate: false, reason: 'conflicting provider outcome' };
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
        paymentProcessorName: providerName,
      },
      { transaction },
    );
    await this.recordEvent(transaction, providerName, event, 'processed');
    return {
      processed: true,
      duplicate: false,
      userId: user.id,
      email: user.email,
      activity: 'wallet.withdrawal.failed',
      details: { amount: Number(withdrawal.amount), withdrawalId: withdrawal.id },
    };
  }

  private recordIgnored(providerName: string, event: providerWebhookEvent) {
    return this.sequelize.transaction(async (transaction): Promise<webhookResult> => {
      if (await this.eventExists(transaction, providerName, event.eventId)) {
        return { processed: false, duplicate: true };
      }
      await this.recordEvent(transaction, providerName, event, 'ignored');
      return { processed: false, duplicate: false, reason: 'event type ignored' };
    });
  }

  private eventExists(transaction: Transaction, providerName: string, eventId: string) {
    return this.webhookEvents
      .count({ where: { providerName, providerEventId: eventId }, transaction })
      .then((count) => count > 0);
  }

  private async recordEvent(
    transaction: Transaction,
    providerName: string,
    event: providerWebhookEvent,
    status: string,
  ): Promise<void> {
    await this.webhookEvents.create(
      {
        providerName,
        providerEventId: event.eventId,
        providerReference: event.reference ?? null,
        eventType: event.providerEventType,
        status,
      },
      { transaction },
    );
  }
}
