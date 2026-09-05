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
})
export class ReportsModule {}
