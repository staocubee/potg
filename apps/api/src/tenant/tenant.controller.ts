import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember } from '../common/decorators/current-user.decorator';
import { TenantService } from './tenant.service';
import { ReportTenantMaintenanceRequestDto } from './dto/report-tenant-maintenance-request.dto';

type AccountMemberCtx = { accountId: string };

// See TenantService's own comment for why this is a separate module
// rather than more routes on PropertiesController. Reuses lease:read/
// maintenance:read/maintenance:write — the same permission keys the
// landlord-facing routes check — rather than inventing tenant-specific
// ones: PermissionsGuard's :propertyId ABAC never triggers here (no
// route below takes a :propertyId param), so the plain RBAC check is
// all that's needed, same reasoning the vendor/supplier trust-audit
// routes gave for reusing vendor:verify/supplier:verify.
@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller('tenant')
export class TenantController {
  constructor(private readonly tenant: TenantService) {}

  @RequirePermissions('lease:read')
  @Get('lease')
  findMyLease(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.tenant.findMyLease(member.accountId);
  }

  @RequirePermissions('maintenance:read')
  @Get('maintenance-requests')
  findMyMaintenanceRequests(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.tenant.findMyMaintenanceRequests(member.accountId);
  }

  @RequirePermissions('maintenance:write')
  @Post('maintenance-requests')
  reportMaintenanceRequest(
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: ReportTenantMaintenanceRequestDto,
  ) {
    return this.tenant.reportMaintenanceRequest(member.accountId, dto);
  }
}
