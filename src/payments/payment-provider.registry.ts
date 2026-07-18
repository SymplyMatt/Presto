import {
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { paymentProcessorModel } from '../database/models';
import { paymentProvider } from './payment-provider';
import { paymentProcessorSeeds } from './payment-processors';

export const paymentProvidersToken = Symbol('paymentProviders');

export interface paymentProcessorView {
  id: string;
  name: string;
  displayName: string;
  isActive: boolean;
  isConfigured: boolean;
}

@Injectable()
export class paymentProviderRegistry implements OnModuleInit {
  private readonly providers: Map<string, paymentProvider>;

  constructor(
    private readonly sequelize: Sequelize,
    @InjectModel(paymentProcessorModel)
    private readonly processorRecords: typeof paymentProcessorModel,
    @Inject(paymentProvidersToken) providers: paymentProvider[],
  ) {
    this.providers = new Map(providers.map((provider) => [provider.name, provider]));
  }

  async onModuleInit(): Promise<void> {
    await this.processorRecords.bulkCreate(
      paymentProcessorSeeds.map((processor) => ({ ...processor })),
      { ignoreDuplicates: true },
    );
  }

  async getActive(): Promise<paymentProvider> {
    const active = await this.processorRecords.findOne({ where: { isActive: true } });
    if (!active) {
      throw new ServiceUnavailableException('no active payment processor is configured');
    }
    return this.require(active.name);
  }

  require(name: string): paymentProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new ServiceUnavailableException(`payment processor '${name}' is not configured`);
    }
    if (!provider.isConfigured()) {
      throw new ServiceUnavailableException(
        `payment processor '${name}' credentials are not configured`,
      );
    }
    return provider;
  }

  async list(): Promise<paymentProcessorView[]> {
    const records = await this.processorRecords.findAll({ order: [['displayName', 'ASC']] });
    return records.map((record) => this.toView(record));
  }

  async activate(name: string): Promise<paymentProcessorView> {
    return this.sequelize.transaction((transaction) =>
      this.activateWithinTransaction(transaction, name.trim().toLowerCase()),
    );
  }

  private async activateWithinTransaction(
    transaction: Transaction,
    name: string,
  ): Promise<paymentProcessorView> {
    const records = await this.processorRecords.findAll({
      order: [['name', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const selected = records.find((record) => record.name === name);
    if (!selected) {
      throw new NotFoundException(`payment processor '${name}' is not supported`);
    }
    const provider = this.providers.get(name);
    if (!provider) {
      throw new ServiceUnavailableException(
        `payment processor '${name}' does not have a registered adapter`,
      );
    }
    if (!provider.isConfigured()) {
      throw new ServiceUnavailableException(
        `payment processor '${name}' credentials are not configured`,
      );
    }
    await this.processorRecords.update({ isActive: false }, { where: {}, transaction });
    await this.processorRecords.update(
      { isActive: true },
      { where: { id: selected.id }, transaction },
    );
    selected.setDataValue('isActive', true);
    return this.toView(selected);
  }

  private toView(record: paymentProcessorModel): paymentProcessorView {
    return {
      id: record.id,
      name: record.name,
      displayName: record.displayName,
      isActive: Boolean(record.isActive),
      isConfigured: this.providers.get(record.name)?.isConfigured() ?? false,
    };
  }
}
