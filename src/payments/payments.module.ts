import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { paymentProcessorModel } from '../database/models';
import { banksController } from './banks.controller';
import { banksService } from './banks.service';
import { paymentProvider } from './payment-provider';
import { paymentProviderRegistry, paymentProvidersToken } from './payment-provider.registry';
import { paymentProcessorsController } from './payment-processors.controller';
import { fincraProvider } from './providers/fincra.provider';
import { flutterwaveProvider } from './providers/flutterwave.provider';
import { monnifyProvider } from './providers/monnify.provider';
import { paystackProvider } from './providers/paystack.provider';

@Module({
  imports: [SequelizeModule.forFeature([paymentProcessorModel])],
  controllers: [paymentProcessorsController, banksController],
  providers: [
    paystackProvider,
    flutterwaveProvider,
    fincraProvider,
    monnifyProvider,
    {
      provide: paymentProvidersToken,
      inject: [paystackProvider, flutterwaveProvider, fincraProvider, monnifyProvider],
      useFactory: (
        paystack: paystackProvider,
        flutterwave: flutterwaveProvider,
        fincra: fincraProvider,
        monnify: monnifyProvider,
      ): paymentProvider[] => [paystack, flutterwave, fincra, monnify],
    },
    paymentProviderRegistry,
    banksService,
  ],
  exports: [paymentProviderRegistry],
})
export class paymentsModule {}
