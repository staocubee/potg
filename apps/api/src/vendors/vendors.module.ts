import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { VendorsService } from './vendors.service';
import { VendorsController } from './vendors.controller';

// Imports PaymentsModule so VendorsController can inject PaymentsService
// directly for the vendor-side dispute routes (raise/resolve/list) — the
// dispute-resolution logic (including the "can't resolve your own
// dispute" check) stays centralized in PaymentsService rather than
// duplicated here.
@Module({
  imports: [PaymentsModule],
  providers: [VendorsService],
  controllers: [VendorsController],
  exports: [VendorsService],
})
export class VendorsModule {}
