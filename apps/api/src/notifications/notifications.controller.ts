import { Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember } from '../common/decorators/current-user.decorator';
import { InAppNotificationsService } from './in-app-notifications.service';

type AccountMemberCtx = { accountId: string };

// Deliberately no @RequirePermissions on the inbox routes below — every
// role of every account type reads and clears its own notifications
// (a vendor, a tenant, a platform_reviewer, all of them), the same way
// nothing gates "which account you're acting as" itself. PermissionsGuard
// already returns true when a route declares no required permissions
// (see its own comment), so this isn't a gap, it's the correct behavior
// for a resource every role equally owns a slice of.
@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: InAppNotificationsService) {}

  @Get()
  findMine(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.notifications.findMine(member.accountId);
  }

  @Patch(':notificationId/read')
  markRead(@Param('notificationId') notificationId: string, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.notifications.markRead(member.accountId, notificationId);
  }

  @Post('read-all')
  markAllRead(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.notifications.markAllRead(member.accountId);
  }

  // The manual-trigger half of "verify without waiting a real day" — see
  // NotificationsSchedulerService's own comment. Unlike ReportsController.
  // sendDigestNow (self-service, scoped to the caller's own account),
  // this sweeps every account's documents platform-wide, so it's gated
  // on account:read_all (platform_admin only) rather than left open —
  // reusing that existing permission rather than inventing a new one for
  // a single operational endpoint.
  @RequirePermissions('account:read_all')
  @Post('check-document-expiry')
  checkDocumentExpiry() {
    return this.notifications.checkDocumentExpiry();
  }
}
