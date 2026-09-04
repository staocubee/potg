import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReportsService } from './reports.service';

// The actual scheduled half of "scheduled reports" — a real @nestjs/
// schedule cron, not a fake toggle that does nothing. Runs once daily
// and reuses the exact same ReportsService.sendDigest a manual "send me
// one now" call goes through, so this job's own correctness is
// verifiable without waiting a real 24 hours for it to fire — call
// sendDigest directly (or POST /reports/digest/send-now) and you're
// running the identical code path this cron would run.
@Injectable()
export class ReportsSchedulerService {
  private readonly logger = new Logger(ReportsSchedulerService.name);

  constructor(private readonly reports: ReportsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async sendDueDigests() {
    const accountIds = await this.reports.findAccountsDueForDigest();
    if (accountIds.length === 0) return;
    this.logger.log(`Sending scheduled portfolio digests to ${accountIds.length} account(s)`);
    for (const accountId of accountIds) {
      try {
        await this.reports.sendDigest(accountId);
      } catch (err) {
        this.logger.error(`Failed to send scheduled digest to account ${accountId}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
