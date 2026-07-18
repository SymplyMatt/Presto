import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { mockEmailProcessor } from './mock-email.processor';
import { notificationQueue, notificationService } from './notification.service';

const queueDisabled = process.env.DISABLE_QUEUE_WORKER === 'true';
const queueImports = queueDisabled ? [] : [BullModule.registerQueue({ name: notificationQueue })];
const queueProviders = queueDisabled
  ? [notificationService]
  : [notificationService, mockEmailProcessor];

@Global()
@Module({
  imports: queueImports,
  providers: queueProviders,
  exports: [notificationService],
})
export class notificationsModule {}
