import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const notificationQueue = 'notifications';

export interface notificationJob {
  email: string;
  activity: string;
  details: Record<string, unknown>;
}

@Injectable()
export class notificationService {
  private readonly logger = new Logger(notificationService.name);

  constructor(
    @Optional()
    @InjectQueue(notificationQueue)
    private readonly queue?: Queue<notificationJob>,
  ) {}

  async notify(email: string, activity: string, details: Record<string, unknown>): Promise<void> {
    if (!this.queue) {
      this.logger.log(`Mock email to ${email}: ${activity} ${JSON.stringify(details)}`);
      return;
    }
    try {
      await Promise.race([
        this.queue.add(
          'activity',
          { email, activity, details },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('notification enqueue timed out')), 5_000),
        ),
      ]);
    } catch (error) {
      this.logger.error('Unable to enqueue activity notification', error);
    }
  }
}
