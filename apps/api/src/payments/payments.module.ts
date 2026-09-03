import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaystackService } from './paystack.service';
import { FlutterwaveService } from './flutterwave.service';
import { PaypalService } from './paypal.service';
import { StripeService } from './stripe.service';
import { PaymentsController, AccountPaymentsController } from './payments.controller';

@Module({
  providers: [PaymentsService, PaystackService, FlutterwaveService, PaypalService, StripeService],
  controllers: [PaymentsController, AccountPaymentsController],
  exports: [PaymentsService, PaystackService, FlutterwaveService, PaypalService, StripeService],
})
export class PaymentsModule {}
