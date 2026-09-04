import { Body, Controller, Get, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember } from '../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';
import { SetDigestSubscriptionDto } from './dto/set-digest-subscription.dto';

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

  // A real CSV file, not the same JSON restated — @Res({ passthrough:
  // true }) so PermissionsGuard/JwtAuthGuard etc. still run normally
  // (passthrough keeps Nest driving the response lifecycle) while this
  // handler sets the headers a browser needs to treat it as a download.
  @RequirePermissions('property:read')
  @Get('portfolio-overview/export')
  async exportPortfolioOverview(@CurrentAccountMember() member: AccountMemberCtx, @Res({ passthrough: true }) res: Response) {
    const csv = await this.reports.getPortfolioOverviewCsv(member.accountId);
    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.header('Content-Disposition', 'attachment; filename="portfolio-overview.csv"');
    return csv;
  }

  // Module 14's scheduled-reports half — see ReportsSchedulerService's
  // own @Cron job for who this actually reaches automatically.
  // property:write since this changes standing account-level config,
  // same tier setVendorLicense-style self-service settings already sit
  // at, not property:read (which every owner-tier role plus viewer has).
  @RequirePermissions('property:write')
  @Patch('digest-subscription')
  setDigestSubscription(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: SetDigestSubscriptionDto) {
    return this.reports.setDigestSubscription(member.accountId, dto.frequency);
  }

  // "Send me one now" — reuses the identical ReportsService.sendDigest
  // the daily cron calls, so this is also how that job's own correctness
  // gets verified without waiting a real day for it to fire.
  @RequirePermissions('property:read')
  @Post('digest-subscription/send-now')
  sendDigestNow(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.reports.sendDigest(member.accountId);
  }
}
