import { Module } from '@nestjs/common';
import { paymentProvider } from './payment-provider';
import { paymentProviderRegistry, paymentProvidersToken } from './payment-provider.registry';
import { paystackProvider } from './providers/paystack.provider';

@Module({
  providers: [
    paystackProvider,
    {
      provide: paymentProvidersToken,
      inject: [paystackProvider],
      useFactory: (paystack: paystackProvider): paymentProvider[] => [paystack],
    },
    paymentProviderRegistry,
  ],
  exports: [paymentProviderRegistry],
})
export class paymentsModule {}
