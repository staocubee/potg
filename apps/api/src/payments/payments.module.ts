import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaystackService } from './paystack.service';
import { PaymentsController, AccountPaymentsController } from './payments.controller';

@Module({
  providers: [PaymentsService, PaystackService],
  controllers: [PaymentsController, AccountPaymentsController],
  exports: [PaymentsService, PaystackService],
})
export class PaymentsModule {}
