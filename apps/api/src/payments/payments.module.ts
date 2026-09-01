import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController, AccountPaymentsController } from './payments.controller';

@Module({
  providers: [PaymentsService],
  controllers: [PaymentsController, AccountPaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
