import { ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectModel } from '@nestjs/sequelize';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { Op, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { currency, ensureSafeMoney } from '../common/money';
import { recentTransactionCutoff, recentTransactionMessage } from '../common/recent-transaction';
import { depositModel, walletModel } from '../database/models';
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
    private readonly wallets: walletsService,
    private readonly providers: paymentProviderRegistry,
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
