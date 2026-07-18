import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SequelizeModule } from '@nestjs/sequelize';
import { userModel, walletModel } from '../database/models';
import { notificationsModule } from '../notifications/notifications.module';
import { authController } from './auth.controller';
import { authService } from './auth.service';
import { jwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    SequelizeModule.forFeature([userModel, walletModel]),
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          // Must be a number: string "3600" is treated as milliseconds by jsonwebtoken/ms.
          expiresIn: Number(configService.get('JWT_EXPIRES_IN_SECONDS', 3600)),
        },
      }),
    }),
    notificationsModule,
  ],
  controllers: [authController],
  providers: [authService, jwtStrategy],
  exports: [jwtStrategy, PassportModule],
})
export class authModule {}
