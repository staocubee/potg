import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { ReportsSchedulerService } from './reports-scheduler.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [ReportsService, ReportsSchedulerService],
  controllers: [ReportsController],
})
export class ReportsModule {}
