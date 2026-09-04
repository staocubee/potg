import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember } from '../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';

type AccountMemberCtx = { accountId: string };

// Account-wide, like AccountPaymentsController — no :propertyId/:projectId
// param for PermissionsGuard's ABAC to key on, so this filters by the
// caller's own accountId directly instead. Gated on property:read (every
// role that can see a portfolio at all already has it; vendor/supplier
// accounts don't, which is correct — this is an owner-side report, not a
// marketplace one).
@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @RequirePermissions('property:read')
  @Get('portfolio-overview')
  getPortfolioOverview(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.reports.getPortfolioOverview(member.accountId);
  }
}
