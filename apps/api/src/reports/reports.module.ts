import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { ReportsSchedulerService } from './reports-scheduler.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [NotificationsModule, PaymentsModule],
  providers: [ReportsService, ReportsSchedulerService],
  controllers: [ReportsController],
  // Exported so AiModule can inject ReportsService directly into
  // AiSkillDeps (see narrate_report) — reusing runDefinition's own
  // metric-registry projection rather than duplicating a 100+ line,
  // cross-module computation a third time inside a skill. Unlike the
  // small (10-20 line) computations model_roi_scenario/
  // estimate_comparable_value duplicate from their own services, this
  // one already reuses PaymentsService.getAccountOverview itself —
  // copying it again would be the actual anti-pattern here, not sharing
  // it.
  exports: [ReportsService],
})
export class ReportsModule {}
