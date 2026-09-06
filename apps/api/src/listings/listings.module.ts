import { Module } from '@nestjs/common';
import { ListingsService } from './listings.service';
import { ListingsController } from './listings.controller';
import { NotificationsModule } from '../notifications/notifications.module';

// NotificationsModule — Module 19 Phase 1's own real-time trigger for a
// new marketplace inquiry (see ListingsService.createInquiry's own
// comment).
@Module({
  imports: [NotificationsModule],
  providers: [ListingsService],
  controllers: [ListingsController],
  exports: [ListingsService],
})
export class ListingsModule {}
