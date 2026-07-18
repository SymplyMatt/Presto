import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import { authModule } from './auth/auth.module';
import { cacheModule } from './cache/cache.module';
import { depositsModule } from './deposits/deposits.module';
import { notificationsModule } from './notifications/notifications.module';
import { paymentsModule } from './payments/payments.module';
import { transfersModule } from './transfers/transfers.module';
import { walletsModule } from './wallets/wallets.module';
import { webhooksModule } from './webhooks/webhooks.module';
import { withdrawalsModule } from './withdrawals/withdrawals.module';
import { appController } from './app.controller';
import { redisConnectionOptions } from './cache/redis-connection';

const validateEnvironment = (values: Record<string, unknown>) => {
  const required = ['DATABASE_URL', 'JWT_SECRET'];
  for (const name of required) {
    if (!values[name]) {
      throw new Error(`${name} is required`);
    }
  }
  return values;
};

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnvironment }),
    SequelizeModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        dialect: 'postgres',
        uri: configService.getOrThrow<string>('DATABASE_URL'),
        autoLoadModels: true,
        synchronize: configService.get('DB_SYNCHRONIZE', 'false') === 'true',
        sync: { force: configService.get('DB_DROP_SCHEMA', 'false') === 'true' },
        dialectOptions:
          configService.get('DATABASE_SSL', 'false') === 'true'
            ? { ssl: { require: true, rejectUnauthorized: false } }
            : undefined,
        logging: false,
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: redisConnectionOptions(configService),
      }),
    }),
    cacheModule,
    notificationsModule,
    paymentsModule,
    authModule,
    walletsModule,
    depositsModule,
    transfersModule,
    withdrawalsModule,
    webhooksModule,
  ],
  controllers: [appController],
})
export class appModule {}
