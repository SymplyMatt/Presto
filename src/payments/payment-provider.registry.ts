import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { paymentProvider } from './payment-provider';

export const paymentProvidersToken = Symbol('paymentProviders');

@Injectable()
export class paymentProviderRegistry {
  private readonly activeProviderName: string;
  private readonly providers: Map<string, paymentProvider>;

  constructor(
    configService: ConfigService,
    @Inject(paymentProvidersToken) providers: paymentProvider[],
  ) {
    this.activeProviderName = configService
      .get<string>('PAYMENT_PROVIDER', 'paystack')
      .toLowerCase();
    this.providers = new Map(providers.map((provider) => [provider.name, provider]));
  }

  getActive(): paymentProvider {
    const provider = this.providers.get(this.activeProviderName);
    if (!provider) {
      throw new ServiceUnavailableException(
        `payment provider '${this.activeProviderName}' is not configured`,
      );
    }
    return provider;
  }
}
