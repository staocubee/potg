import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MaterialsService } from './materials.service';
import { MaterialsController } from './materials.controller';

// Imports PaymentsModule so MaterialsController can inject
// PaymentsService directly for the order-dispute routes (Module 18
// Phase 1) — same reasoning VendorsModule's own import of PaymentsModule
// already documents for its project-dispute routes. NotificationsModule
// is for MaterialsService.confirmReceipt's own real notification to the
// supplier — see its own comment.
@Module({
  imports: [PaymentsModule, NotificationsModule],
  providers: [MaterialsService],
  controllers: [MaterialsController],
  exports: [MaterialsService],
})
export class MaterialsModule {}
