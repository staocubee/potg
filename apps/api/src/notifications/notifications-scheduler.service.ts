import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InAppNotificationsService } from './in-app-notifications.service';

// The scheduled trigger half of Module 19 Phase 1 — a real
// @nestjs/schedule cron, same shape ReportsSchedulerService already
// establishes: reuses the exact same method a manual check would call
// (NotificationsController.checkDocumentExpiry), so this job's own
// correctness is verifiable without waiting a real day for it to fire.
//
// Module 21 Phase 1's own "Time-zone aware notifications" made this
// hourly instead of once at a single fixed UTC hour: a single daily
// firing has no one correct UTC hour when accounts span every timezone
// on the platform — 9am UTC is already mid-morning in Lagos but the
// middle of the night in California. Every hour, this asks
// checkDocumentExpiry to only actually notify the accounts where it's
// currently ~9am *local* — a real per-account timezone check
// (Account.timezone), not a per-account job scheduler (which would need
// a real job queue, out of scope for this pass).
@Injectable()
export class NotificationsSchedulerService {
  private readonly logger = new Logger(NotificationsSchedulerService.name);
  private static readonly TARGET_LOCAL_HOUR = 9;

  constructor(private readonly notifications: InAppNotificationsService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async checkDocumentExpiry() {
    const { checked, created } = await this.notifications.checkDocumentExpiry(30, NotificationsSchedulerService.TARGET_LOCAL_HOUR);
    if (created > 0) {
      this.logger.log(`Document expiry check: ${checked} document(s) in window, ${created} new notification(s)`);
    }
  }
}
