import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaystackService } from './paystack.service';
import { FlutterwaveService } from './flutterwave.service';
import { PaypalService } from './paypal.service';
import { StripeService } from './stripe.service';
import { PaymentsController, AccountPaymentsController } from './payments.controller';
import { NotificationsModule } from '../notifications/notifications.module';

// NotificationsModule — Module 19 Phase 1's own real-time trigger for a
// newly raised dispute (see PaymentsService's own raiseDispute/
// raiseDisputeAsVendor/raiseOrderDispute comments).
@Module({
  imports: [NotificationsModule],
  providers: [PaymentsService, PaystackService, FlutterwaveService, PaypalService, StripeService],
  controllers: [PaymentsController, AccountPaymentsController],
  exports: [PaymentsService, PaystackService, FlutterwaveService, PaypalService, StripeService],
})
export class PaymentsModule {}
