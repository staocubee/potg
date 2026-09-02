import { Module } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';
import { InvitesController } from './invites.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [AccountsService],
  controllers: [AccountsController, InvitesController],
  exports: [AccountsService],
})
export class AccountsModule {}
