import { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'ioredis';

export const redisConnectionOptions = (configService: ConfigService): RedisOptions => {
  const tlsEnabled = configService.get('REDIS_TLS', 'false') === 'true';
  return {
    host: configService.get('REDIS_HOST', 'localhost'),
    port: Number(configService.get('REDIS_PORT', 6379)),
    username: configService.get<string>('REDIS_USERNAME') || undefined,
    password: configService.get<string>('REDIS_PASSWORD') || undefined,
    tls: tlsEnabled ? {} : undefined,
    maxRetriesPerRequest: 1,
    connectTimeout: 10_000,
  };
};
