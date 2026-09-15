import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentUser, CurrentAccountMember } from '../common/decorators/current-user.decorator';
import { PlatformAdminService } from './platform-admin.service';
import { SuspendAccountDto } from './dto/suspend-account.dto';

type UserCtx = { id: string };
type AccountMemberCtx = { accountId: string };

// Platform-wide, like ComplianceController already is — no :accountId
// param anywhere here for PermissionsGuard's own ABAC check to key on
// (deliberately :targetAccountId instead — see PlatformAdminService's own
// comment; a literal :accountId param would trip PermissionsGuard's IDOR
// check and 404 on every account except the caller's own, the same trap
// vendor:verify's own :vendorId param already avoids). Gated purely by
// account:read_all/account:suspend, which only platform_admin carries.
@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller('platform-admin')
export class PlatformAdminController {
  constructor(private readonly admin: PlatformAdminService) {}

  @RequirePermissions('account:read_all')
  @Get('accounts')
  listAccounts() {
    return this.admin.listAccounts();
  }

  // The nav audit's own finding: "Properties / Listings — missing, no
  // property/listing management routes for admin at all."
  @RequirePermissions('account:read_all')
  @Get('properties')
  listProperties() {
    return this.admin.listProperties();
  }

  @RequirePermissions('account:read_all')
  @Get('listings')
  listListings() {
    return this.admin.listListings();
  }

  // The nav audit's own finding: "Transactions — missing as a ledger —
  // only an aggregate 'Marketplace GMV' dollar total, not a transaction
  // count/list."
  @RequirePermissions('account:read_all')
  @Get('transactions')
  listTransactions() {
    return this.admin.listTransactions();
  }

  // The nav audit's own finding: "Escrow — missing as its own page —
  // only an aggregate stat tile."
  @RequirePermissions('account:read_all')
  @Get('escrow')
  listEscrowAccounts() {
    return this.admin.listEscrowAccounts();
  }

  @RequirePermissions('account:suspend')
  @Post('accounts/:targetAccountId/suspend')
  suspendAccount(
    @Param('targetAccountId') targetAccountId: string,
    @Body() dto: SuspendAccountDto,
    @CurrentAccountMember() member: AccountMemberCtx,
    @CurrentUser() user: UserCtx,
  ) {
    return this.admin.suspendAccount(targetAccountId, dto.reason, member.accountId, user.id);
  }

  @RequirePermissions('account:suspend')
  @Post('accounts/:targetAccountId/reinstate')
  reinstateAccount(
    @Param('targetAccountId') targetAccountId: string,
    @Body() dto: SuspendAccountDto,
    @CurrentUser() user: UserCtx,
  ) {
    return this.admin.reinstateAccount(targetAccountId, dto.reason, user.id);
  }

  @RequirePermissions('account:read_all')
  @Get('audit-log')
  getAuditLog() {
    return this.admin.getAuditLog();
  }

  // Module 24's "Platform Admin Reports" — see PlatformAdminService.
  // getPlatformReports's own comment for why these live here rather than
  // in the (deliberately account-scoped) Reports module.
  @RequirePermissions('account:read_all')
  @Get('reports')
  getPlatformReports() {
    return this.admin.getPlatformReports();
  }
}
