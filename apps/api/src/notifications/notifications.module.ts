import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { InAppNotificationsService } from './in-app-notifications.service';
import { NotificationsSchedulerService } from './notifications-scheduler.service';
import { NotificationsController } from './notifications.controller';

// Module 19 Phase 1 — InAppNotificationsService/NotificationsScheduler
// service alongside the pre-existing EmailService: the two real channels
// this pass covers. Exported so Projects/Properties/Payments/Listings
// can each import this module and inject InAppNotificationsService
// directly for their own real-time triggers, same "import the module,
// inject its service" shape those modules already use for PaymentsModule
// (Vendors/Materials, for dispute routes) and NotificationsModule itself
// (Accounts/Auth/Reports, for EmailService).
@Module({
  providers: [EmailService, InAppNotificationsService, NotificationsSchedulerService],
  controllers: [NotificationsController],
  exports: [EmailService, InAppNotificationsService],
})
export class NotificationsModule {}
