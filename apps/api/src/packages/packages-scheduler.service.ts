import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PackagesService } from './packages.service';

// The actual scheduled half of real auto-renewal — a real @nestjs/
// schedule cron, not a fake toggle that does nothing. Same shape as
// ReportsSchedulerService.sendDueDigests: runs once daily and calls
// PackagesService.processAutoRenewals, which loops the exact same
// chargeRenewal a single subscription's own self-service
// POST /packages/subscriptions/:id/renew-now goes through — no separate
// platform-wide "run the batch now" admin endpoint, since renew-now
// already exercises the identical real charge path per-subscription.
@Injectable()
export class PackagesSchedulerService {
  private readonly logger = new Logger(PackagesSchedulerService.name);

  constructor(private readonly packages: PackagesService) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async runDueRenewals() {
    const result = await this.packages.processAutoRenewals();
    if (result.attempted === 0) return;
    this.logger.log(`Auto-renewals: ${result.renewed} succeeded, ${result.failed} failed, ${result.attempted} attempted`);
  }
}
