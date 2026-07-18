import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectModel } from '@nestjs/sequelize';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { Op, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { currency, ensureSafeMoney } from '../common/money';
import { recentTransactionCutoff, recentTransactionMessage } from '../common/recent-transaction';
import { depositModel, ledgerEntryModel, walletModel } from '../database/models';
import { notificationService } from '../notifications/notification.service';
import { paymentProvider } from '../payments/payment-provider';
import { paymentProviderRegistry } from '../payments/payment-provider.registry';
import { walletsService } from '../wallets/wallets.service';
import { createDepositDto } from './dto/create-deposit.dto';

export const depositExpireQueue = 'deposit-expire';

export interface depositExpireJob {
  depositId: string;
}

export interface depositView {
  id: string;
  amount: number;
  currency: string;
  paymentProcessor: string;
  reference: string;
  status: string;
  checkoutUrl: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
}

@Injectable()
export class depositsService {
  private readonly logger = new Logger(depositsService.name);

  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(depositModel) private readonly deposits: typeof depositModel,
    @InjectModel(walletModel) private readonly walletRecords: typeof walletModel,
    @InjectModel(ledgerEntryModel) private readonly ledgerEntries: typeof ledgerEntryModel,
    private readonly wallets: walletsService,
    private readonly providers: paymentProviderRegistry,
    private readonly notifications: notificationService,
    private readonly configService: ConfigService,
    @Optional()
    @InjectQueue(depositExpireQueue)
    private readonly expireQueue?: Queue<depositExpireJob>,
  ) {}

  async create(userId: string, email: string, input: createDepositDto): Promise<depositView> {
    ensureSafeMoney(input.amount);
    const wallet = await this.wallets.getByUserId(userId);
    const provider = await this.providers.getActive();
    const deposit = await this.sequelize.transaction((transaction) =>
      this.createPending(transaction, wallet.id, provider, input),
    );

    try {
      const initialized = await provider.initializeDeposit({
        amount: deposit.amount,
        currency: deposit.currency,
        email,
        reference: deposit.providerReference,
        callbackUrl: `${this.configService.get('APP_BASE_URL', 'http://localhost:3000')}/docs`,
      });
      deposit.checkoutUrl = initialized.checkoutUrl;
      deposit.accessCode = initialized.accessCode ?? null;
      await deposit.save();
      await this.scheduleExpiry(deposit.id);
      return this.toView(deposit);
    } catch (error) {
      deposit.status = 'failed';
      await deposit.save();
      throw error;
    }
  }

  private async createPending(
    transaction: Transaction,
    walletId: string,
    provider: paymentProvider,
    input: createDepositDto,
  ): Promise<depositModel> {
    const wallet = await this.walletRecords.findByPk(walletId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!wallet) {
      throw new NotFoundException('wallet not found');
    }
    const recent = await this.deposits.findOne({
      where: {
        walletId,
        amount: input.amount,
        currency,
        createdAt: { [Op.gte]: recentTransactionCutoff() },
      },
      transaction,
    });
    if (recent) {
      throw new ConflictException(recentTransactionMessage);
    }
    return this.deposits.create(
      {
        walletId,
        amount: input.amount,
        currency,
        providerName: provider.name,
        providerReference: `dep-${randomUUID()}`,
        idempotencyKey: randomUUID(),
        status: 'pending',
      },
      { transaction },
    );
  }

  async get(userId: string, id: string): Promise<depositView> {
    const wallet = await this.wallets.getByUserId(userId);
    const deposit = await this.deposits.findOne({ where: { id, walletId: wallet.id } });
    if (!deposit) {
      throw new NotFoundException('deposit not found');
    }
    return this.toView(deposit);
  }

  async list(userId: string): Promise<depositView[]> {
    const wallet = await this.wallets.getByUserId(userId);
    const deposits = await this.deposits.findAll({
      where: { walletId: wallet.id },
      order: [['createdAt', 'DESC']],
    });
    return deposits.map((deposit) => this.toView(deposit));
  }

  async verifyByReference(
    userId: string,
    email: string,
    reference: string,
  ): Promise<depositView> {
    const wallet = await this.wallets.getByUserId(userId);
    const existing = await this.deposits.findOne({
      where: { walletId: wallet.id, providerReference: reference.trim() },
    });
    if (!existing) {
      throw new NotFoundException('deposit not found');
    }
    if (existing.status === 'confirmed') {
      return this.toView(existing);
    }

    const provider = this.providers.require(existing.providerName);
    const verified = await provider.verifyDeposit(existing.providerReference);

    if (verified.status === 'pending') {
      return this.toView(existing);
    }

    if (verified.status === 'failed') {
      return this.markFailedIfPending(existing.id);
    }

    if (verified.amount !== Number(existing.amount) || verified.currency !== existing.currency) {
      throw new ConflictException('deposit details do not match provider verification');
    }

    const confirmed = await this.confirmIfEligible(existing.id);
    await this.wallets.invalidate(userId);
    if (confirmed.status === 'confirmed') {
      void this.notifications.notify(email, 'wallet.deposit.confirmed', {
        amount: Number(confirmed.amount),
        depositId: confirmed.id,
      });
    }
    return this.toView(confirmed);
  }

  async expireIfPending(depositId: string): Promise<boolean> {
    return this.sequelize.transaction(async (transaction) => {
      const deposit = await this.deposits.findByPk(depositId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!deposit || deposit.status !== 'pending') {
        return false;
      }
      deposit.status = 'failed';
      await deposit.save({ transaction });
      return true;
    });
  }

  private async markFailedIfPending(depositId: string): Promise<depositView> {
    return this.sequelize.transaction(async (transaction) => {
      const deposit = await this.deposits.findByPk(depositId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!deposit) {
        throw new NotFoundException('deposit not found');
      }
      if (deposit.status === 'pending') {
        deposit.status = 'failed';
        await deposit.save({ transaction });
      }
      return this.toView(deposit);
    });
  }

  private async confirmIfEligible(depositId: string): Promise<depositModel> {
    return this.sequelize.transaction(async (transaction) => {
      const deposit = await this.deposits.findByPk(depositId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!deposit) {
        throw new NotFoundException('deposit not found');
      }
      if (deposit.status === 'confirmed') {
        return deposit;
      }
      if (deposit.status !== 'pending' && deposit.status !== 'failed') {
        throw new ConflictException('deposit not eligible for credit');
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
          paymentProcessorName: deposit.providerName,
        },
        { transaction },
      );
      return deposit;
    });
  }

  private async scheduleExpiry(depositId: string): Promise<void> {
    if (!this.expireQueue) {
      return;
    }
    const ttlSeconds = Number(this.configService.get('DEPOSIT_PENDING_TTL_SECONDS', 3600));
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
      this.logger.warn('DEPOSIT_PENDING_TTL_SECONDS must be a positive number; skipping expiry');
      return;
    }
    try {
      await this.expireQueue.add(
        'expire',
        { depositId },
        {
          delay: ttlSeconds * 1000,
          jobId: `deposit-expire-${depositId}`,
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      );
    } catch (error) {
      this.logger.error(`Unable to schedule expiry for deposit ${depositId}`, error);
    }
  }

  private toView(deposit: depositModel): depositView {
    return {
      id: deposit.id,
      amount: Number(deposit.amount),
      currency: deposit.currency,
      paymentProcessor: deposit.providerName,
      reference: deposit.providerReference,
      status: deposit.status,
      checkoutUrl: deposit.checkoutUrl,
      createdAt: deposit.createdAt,
      confirmedAt: deposit.confirmedAt,
    };
  }
}
