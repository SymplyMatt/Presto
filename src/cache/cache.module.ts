import { Global, Module } from '@nestjs/common';
import { redisCacheService } from './redis-cache.service';

@Global()
@Module({
  providers: [redisCacheService],
  exports: [redisCacheService],
})
export class cacheModule {}
