import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { depositExpireJob, depositExpireQueue, depositsService } from './deposits.service';

@Processor(depositExpireQueue)
export class depositExpireProcessor extends WorkerHost {
  private readonly logger = new Logger(depositExpireProcessor.name);

  constructor(private readonly deposits: depositsService) {
    super();
  }

  async process(job: Job<depositExpireJob>): Promise<void> {
    const expired = await this.deposits.expireIfPending(job.data.depositId);
    if (expired) {
      this.logger.log(`Expired pending deposit ${job.data.depositId}`);
    }
  }
}
