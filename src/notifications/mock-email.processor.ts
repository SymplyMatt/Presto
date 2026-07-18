import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { notificationJob, notificationQueue } from './notification.service';

@Processor(notificationQueue)
export class mockEmailProcessor extends WorkerHost {
  private readonly logger = new Logger(mockEmailProcessor.name);

  async process(job: Job<notificationJob>): Promise<void> {
    const { email, activity, details } = job.data;
    this.logger.log(`Mock email to ${email}: ${activity} ${JSON.stringify(details)}`);
  }
}
