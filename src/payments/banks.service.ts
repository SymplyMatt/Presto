import { Injectable, Logger } from '@nestjs/common';
import { redisCacheService } from '../cache/redis-cache.service';
import { bankInfo } from './payment-provider';
import { paymentProviderRegistry } from './payment-provider.registry';

const banksCacheTtlSeconds = 60 * 60 * 24;

@Injectable()
export class banksService {
  private readonly logger = new Logger(banksService.name);

  constructor(
    private readonly providers: paymentProviderRegistry,
    private readonly cache: redisCacheService,
  ) {}

  async list(): Promise<bankInfo[]> {
    const provider = await this.providers.getActive();
    const cacheKey = `banks:provider:${provider.name}`;

    try {
      const cached = await this.cache.getJson<bankInfo[]>(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (error) {
      this.logger.warn('Banks cache read failed', error);
    }

    const banks = await provider.listBanks();
    const sorted = [...banks].sort((left, right) => left.name.localeCompare(right.name));

    try {
      await this.cache.setJson(cacheKey, sorted, banksCacheTtlSeconds);
    } catch (error) {
      this.logger.warn('Banks cache write failed', error);
    }

    return sorted;
  }
}
