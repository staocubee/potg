import { Module } from '@nestjs/common';
import { PackagesService } from './packages.service';
import { PackagesSchedulerService } from './packages-scheduler.service';
import { PackagesController } from './packages.controller';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';

// Imports PaymentsModule for its already-exported gateway services
// (Paystack/Flutterwave/Paypal/Stripe) rather than re-providing them here
// — one real set of gateway clients, not two. NotificationsModule for
// InAppNotificationsService — PackagesService's own real auto-renewal
// notifies an account when a renewal succeeds or fails (see
// PackagesService.chargeRenewal).
@Module({
  imports: [PaymentsModule, NotificationsModule],
  providers: [PackagesService, PackagesSchedulerService],
  controllers: [PackagesController],
  exports: [PackagesService],
})
export class PackagesModule {}
