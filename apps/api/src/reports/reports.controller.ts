import { Body, Controller, Delete, Get, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember } from '../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';
import { SetDigestSubscriptionDto } from './dto/set-digest-subscription.dto';
import { CreateReportDefinitionDto } from './dto/create-report-definition.dto';

type AccountMemberCtx = { accountId: string };

// Account-wide, like AccountPaymentsController — no :propertyId/:projectId
// param for PermissionsGuard's ABAC to key on, so this filters by the
// caller's own accountId directly instead. Gated on report:read/write —
// the RBAC/ABAC audit's own finding: this whole controller used to ride
// on property:read/write, even though "can see a portfolio" and "can
// run/save/schedule a report on it" are reasonable to grant separately.
// Granted to exactly the same roles that had property:read/write before,
// so no behavior change for anyone — vendor/supplier accounts still don't
// get it, which is correct: this is an owner-side report, not a
// marketplace one.
@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @RequirePermissions('report:read')
  @Get('portfolio-overview')
  getPortfolioOverview(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.reports.getPortfolioOverview(member.accountId);
  }

  // A real CSV file, not the same JSON restated — @Res({ passthrough:
  // true }) so PermissionsGuard/JwtAuthGuard etc. still run normally
  // (passthrough keeps Nest driving the response lifecycle) while this
  // handler sets the headers a browser needs to treat it as a download.
  @RequirePermissions('report:read')
  @Get('portfolio-overview/export')
  async exportPortfolioOverview(@CurrentAccountMember() member: AccountMemberCtx, @Res({ passthrough: true }) res: Response) {
    const csv = await this.reports.getPortfolioOverviewCsv(member.accountId);
    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.header('Content-Disposition', 'attachment; filename="portfolio-overview.csv"');
    return csv;
  }

  // The cross-portfolio "at-risk projects/leases/vendors/suppliers" view
  // — see ReportsService.getAtRiskOverview's own comment for what "work
  // with" means for the vendor/supplier half. report:read, same tier
  // as portfolio-overview: this is an owner-side report, not a
  // marketplace-facing endpoint a vendor/supplier account itself would
  // call.
  @RequirePermissions('report:read')
  @Get('at-risk-overview')
  getAtRiskOverview(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.reports.getAtRiskOverview(member.accountId);
  }

  // Module 14's scheduled-reports half — see ReportsSchedulerService's
  // own @Cron job for who this actually reaches automatically.
  // report:write since this changes standing account-level config, same
  // tier setVendorLicense-style self-service settings already sit at, not
  // report:read (which every owner-tier role plus viewer has).
  @RequirePermissions('report:write')
  @Patch('digest-subscription')
  setDigestSubscription(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: SetDigestSubscriptionDto) {
    return this.reports.setDigestSubscription(member.accountId, dto.frequency);
  }

  // "Send me one now" — reuses the identical ReportsService.sendDigest
  // the daily cron calls, so this is also how that job's own correctness
  // gets verified without waiting a real day for it to fire.
  @RequirePermissions('report:read')
  @Post('digest-subscription/send-now')
  sendDigestNow(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.reports.sendDigest(member.accountId);
  }

  // --- Report builder — "a real report builder", not just the one fixed
  // portfolio-overview shape above. Same report:read/write split as the
  // rest of this controller: read the registry/saved reports/run results
  // with report:read, create/delete with report:write.

  @RequirePermissions('report:read')
  @Get('metrics')
  listMetrics() {
    return this.reports.listMetrics();
  }

  @RequirePermissions('report:write')
  @Post('definitions')
  createDefinition(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: CreateReportDefinitionDto) {
    return this.reports.createDefinition(member.accountId, dto.name, dto.metrics);
  }

  @RequirePermissions('report:read')
  @Get('definitions')
  findDefinitions(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.reports.findDefinitions(member.accountId);
  }

  @RequirePermissions('report:write')
  @Delete('definitions/:id')
  deleteDefinition(@CurrentAccountMember() member: AccountMemberCtx, @Param('id') id: string) {
    return this.reports.deleteDefinition(member.accountId, id);
  }

  @RequirePermissions('report:read')
  @Get('definitions/:id/run')
  runDefinition(@CurrentAccountMember() member: AccountMemberCtx, @Param('id') id: string) {
    return this.reports.runDefinition(member.accountId, id);
  }

  @RequirePermissions('report:read')
  @Get('definitions/:id/export')
  async exportDefinition(
    @CurrentAccountMember() member: AccountMemberCtx,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.reports.exportDefinitionCsv(member.accountId, id);
    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.header('Content-Disposition', 'attachment; filename="report.csv"');
    return csv;
  }
}
