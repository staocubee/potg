import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { MaterialsService } from './materials.service';
import { MaterialsController } from './materials.controller';

// Imports PaymentsModule so MaterialsController can inject
// PaymentsService directly for the order-dispute routes (Module 18
// Phase 1) — same reasoning VendorsModule's own import of PaymentsModule
// already documents for its project-dispute routes.
@Module({
  imports: [PaymentsModule],
  providers: [MaterialsService],
  controllers: [MaterialsController],
  exports: [MaterialsService],
})
export class MaterialsModule {}
