import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember, CurrentUser } from '../common/decorators/current-user.decorator';
import { PackagesService } from './packages.service';
import { SubscribePackageDto } from './dto/subscribe-package.dto';
import { SetAutoRenewDto } from './dto/set-auto-renew.dto';

type AccountMemberCtx = { accountId: string };
type UserCtx = { id: string; email: string };

// No :projectId/:accountId route param — same "no ABAC key needed, the
// caller's own accountId from CurrentAccountMember is enough" shape as
// AccountPaymentsController.
@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller('packages')
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}

  @RequirePermissions('package:read')
  @Get()
  findCatalog() {
    return this.packages.findCatalog();
  }

  @RequirePermissions('package:read')
  @Get('me')
  findMine(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.packages.findMySubscriptions(member.accountId);
  }

  @RequirePermissions('package:read')
  @Get('me/active')
  findMyActive(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.packages.getMyActiveBoost(member.accountId);
  }

  @RequirePermissions('package:write')
  @Post('subscribe')
  subscribe(
    @CurrentAccountMember() member: AccountMemberCtx,
    @CurrentUser() user: UserCtx,
    @Body() dto: SubscribePackageDto,
  ) {
    return this.packages.subscribe(member.accountId, user.email, dto);
  }

  @RequirePermissions('package:write')
  @Post('subscriptions/:subscriptionId/verify')
  verify(@CurrentAccountMember() member: AccountMemberCtx, @Param('subscriptionId') subscriptionId: string) {
    return this.packages.verifySubscription(member.accountId, subscriptionId);
  }

  // The real "cancel my subscription" action — see
  // PackagesService.setAutoRenew's own comment for why this never touches
  // the current boost's own status/expiresAt, only whether it renews.
  @RequirePermissions('package:write')
  @Patch('subscriptions/:subscriptionId/auto-renew')
  setAutoRenew(
    @CurrentAccountMember() member: AccountMemberCtx,
    @Param('subscriptionId') subscriptionId: string,
    @Body() dto: SetAutoRenewDto,
  ) {
    return this.packages.setAutoRenew(member.accountId, subscriptionId, dto.autoRenew);
  }

  // Self-service — charges the same real Paystack authorization the daily
  // cron would, on demand. See PackagesService.renewNow's own comment.
  @RequirePermissions('package:write')
  @Post('subscriptions/:subscriptionId/renew-now')
  renewNow(@CurrentAccountMember() member: AccountMemberCtx, @Param('subscriptionId') subscriptionId: string) {
    return this.packages.renewNow(member.accountId, subscriptionId);
  }
}
