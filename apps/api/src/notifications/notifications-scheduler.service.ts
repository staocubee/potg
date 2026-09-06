import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InAppNotificationsService } from './in-app-notifications.service';

// The scheduled trigger half of Module 19 Phase 1 — a real
// @nestjs/schedule cron, same shape ReportsSchedulerService already
// establishes: reuses the exact same method a manual check would call
// (NotificationsController.checkDocumentExpiry), so this job's own
// correctness is verifiable without waiting a real day for it to fire.
@Injectable()
export class NotificationsSchedulerService {
  private readonly logger = new Logger(NotificationsSchedulerService.name);

  constructor(private readonly notifications: InAppNotificationsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async checkDocumentExpiry() {
    const { checked, created } = await this.notifications.checkDocumentExpiry();
    if (created > 0) {
      this.logger.log(`Document expiry check: ${checked} document(s) in window, ${created} new notification(s)`);
    }
  }
}
