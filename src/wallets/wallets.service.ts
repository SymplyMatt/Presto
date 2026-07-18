import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { redisCacheService } from '../cache/redis-cache.service';
import { ledgerEntryModel, walletModel } from '../database/models';

export interface walletView {
  id: string;
  balance: number;
  currency: string;
}

@Injectable()
export class walletsService {
  private readonly logger = new Logger(walletsService.name);

  constructor(
    @InjectModel(walletModel) private readonly wallets: typeof walletModel,
    @InjectModel(ledgerEntryModel) private readonly ledgerEntries: typeof ledgerEntryModel,
    private readonly cache: redisCacheService,
  ) {}

  async getByUserId(userId: string): Promise<walletModel> {
    const wallet = await this.wallets.findOne({ where: { userId } });
    if (!wallet) {
      throw new NotFoundException('wallet not found');
    }
    return wallet;
  }

  async getView(userId: string): Promise<walletView> {
    const key = this.cacheKey(userId);
    try {
      const cached = await this.cache.getJson<walletView>(key);
      if (cached) {
        return cached;
      }
    } catch (error) {
      this.logger.warn('Wallet cache read failed', error);
    }

    const wallet = await this.getByUserId(userId);
    const view = { id: wallet.id, balance: Number(wallet.balance), currency: wallet.currency };
    try {
      await this.cache.setJson(key, view);
    } catch (error) {
      this.logger.warn('Wallet cache write failed', error);
    }
    return view;
  }

  async listLedger(userId: string, page = 1, limit = 20) {
    const wallet = await this.getByUserId(userId);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);
    const result = await this.ledgerEntries.findAndCountAll({
      where: { walletId: wallet.id },
      order: [['createdAt', 'DESC']],
      offset: (safePage - 1) * safeLimit,
      limit: safeLimit,
    });
    const items = result.rows.map((entry) => {
      const { paymentProcessorName, ...item } = entry.toJSON();
      return {
        ...item,
        amount: Number(entry.amount),
        balanceAfter: Number(entry.balanceAfter),
        paymentProcessor: paymentProcessorName,
      };
    });
    return { items, total: result.count, page: safePage, limit: safeLimit };
  }

  async invalidate(userId: string): Promise<void> {
    try {
      await this.cache.delete(this.cacheKey(userId));
    } catch (error) {
      this.logger.warn('Wallet cache invalidation failed', error);
    }
  }

  private cacheKey(userId: string): string {
    return `wallet:user:${userId}`;
  }
}
