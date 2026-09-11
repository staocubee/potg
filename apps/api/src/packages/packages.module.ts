import { Module } from '@nestjs/common';
import { PackagesService } from './packages.service';
import { PackagesController } from './packages.controller';
import { PaymentsModule } from '../payments/payments.module';

// Imports PaymentsModule for its already-exported gateway services
// (Paystack/Flutterwave/Paypal/Stripe) rather than re-providing them here
// — one real set of gateway clients, not two.
@Module({
  imports: [PaymentsModule],
  providers: [PackagesService],
  controllers: [PackagesController],
  exports: [PackagesService],
})
export class PackagesModule {}
