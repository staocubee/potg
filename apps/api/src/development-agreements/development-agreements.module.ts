import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { DevelopmentAgreementsService } from './development-agreements.service';
import { DevelopmentAgreementsController } from './development-agreements.controller';
import { DevelopmentAgreementInvitesController } from './development-agreement-invites.controller';

@Module({
  imports: [NotificationsModule],
  providers: [DevelopmentAgreementsService],
  controllers: [DevelopmentAgreementsController, DevelopmentAgreementInvitesController],
  exports: [DevelopmentAgreementsService],
})
export class DevelopmentAgreementsModule {}
