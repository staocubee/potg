import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember } from '../common/decorators/current-user.decorator';
import { TenantService } from './tenant.service';
import { ReportTenantMaintenanceRequestDto } from './dto/report-tenant-maintenance-request.dto';
import { PayRentScheduleEntryDto } from './dto/pay-rent-schedule-entry.dto';

type AccountMemberCtx = { accountId: string };

// See TenantService's own comment for why this is a separate module
// rather than more routes on PropertiesController. Mostly reuses
// lease:read/maintenance:read/maintenance:write/document:read — the
// same permission keys the landlord-facing routes check — rather than
// inventing tenant-specific ones: PermissionsGuard's :propertyId ABAC
// never triggers here (no route below takes a :propertyId param), so
// the plain RBAC check is all that's needed, same reasoning the vendor/
// supplier trust-audit routes gave for reusing vendor:verify/
// supplier:verify. `lease:pay` (below) is the one deliberate exception —
// see its own seed.ts comment for why paying a real due entry needed a
// permission narrower than lease:write rather than reusing it.
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

  @RequirePermissions('document:read')
  @Get('documents')
  findMyDocuments(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.tenant.findMyDocuments(member.accountId);
  }

  @RequirePermissions('lease:read')
  @Get('announcements')
  findMyAnnouncements(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.tenant.findMyAnnouncements(member.accountId);
  }

  @RequirePermissions('maintenance:write')
  @Post('maintenance-requests')
  reportMaintenanceRequest(
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: ReportTenantMaintenanceRequestDto,
  ) {
    return this.tenant.reportMaintenanceRequest(member.accountId, dto);
  }

  @RequirePermissions('lease:pay')
  @Post('lease/rent-schedule/:entryId/pay')
  payRentScheduleEntry(
    @CurrentAccountMember() member: AccountMemberCtx,
    @Param('entryId') entryId: string,
    @Body() dto: PayRentScheduleEntryDto,
  ) {
    return this.tenant.payRentScheduleEntry(member.accountId, entryId, dto);
  }
}
