import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';

const DIGEST_FREQUENCIES = ['off', 'weekly', 'monthly'] as const;

// Real CSV escaping (RFC 4180) — quote a field only when it actually
// needs it, doubling any embedded quote. Not a fake "just join with
// commas" export: a property name or address with a comma in it (a
// real, common case) would silently corrupt every column after it
// without this.
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
function csvRow(fields: (string | number)[]): string {
  return fields.map((f) => csvField(String(f))).join(',');
}

// The "full fixed-dashboard side of reports" the Technical Architecture
// section calls out separately from the AI-narrated side
// (generate_portfolio_report already covers that half). This is the
// deterministic counterpart: real counts and totals across every
// property an account owns, computed fresh on every request — same
// "grouped by currency, never summed across them" caution
// PaymentsService.getAccountOverview already uses for money, since one
// account can still run projects in more than one currency even though
// Property.estimatedValue itself is implicitly the account's own single
// currency (Property has no currency field of its own).
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  private countByStatus(items: { status: string }[]) {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
    return Array.from(counts, ([status, count]) => ({ status, count }));
  }

  async getPortfolioOverview(accountId: string) {
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      select: { currency: true, reportDigestFrequency: true },
    });

    const [properties, projects, maintenanceRequests, inspections, payouts] = await Promise.all([
      this.prisma.property.findMany({ where: { accountId }, select: { status: true, estimatedValue: true } }),
      this.prisma.project.findMany({ where: { accountId }, select: { status: true } }),
      this.prisma.maintenanceRequest.findMany({ where: { property: { accountId } }, select: { status: true } }),
      this.prisma.propertyInspection.findMany({ where: { property: { accountId } }, select: { status: true, overallResult: true } }),
      this.prisma.payout.findMany({
        where: { project: { accountId }, status: { not: 'failed' } },
        select: { amount: true, currency: true, vendorId: true, vendor: { select: { businessName: true } } },
      }),
    ]);

    const completedInspections = inspections.filter((i: { status: string }) => i.status === 'completed');
    const countResult = (result: string) =>
      completedInspections.filter((i: { overallResult: string | null }) => i.overallResult === result).length;

    // Grouped by (vendor, currency) — a vendor can in principle be paid
    // out of more than one project in more than one currency, and this
    // never adds those together into one misleading number, same
    // reasoning getAccountOverview already applies to deposits/releases.
    const spendByVendor = new Map<string, { vendorId: string; businessName: string; currency: string; total: number }>();
    const spendByCurrency = new Map<string, number>();
    for (const p of payouts as { amount: unknown; currency: string; vendorId: string; vendor: { businessName: string } }[]) {
      const amount = Number(p.amount);
      spendByCurrency.set(p.currency, (spendByCurrency.get(p.currency) ?? 0) + amount);
      const key = `${p.vendorId}:${p.currency}`;
      const existing = spendByVendor.get(key);
      if (existing) {
        existing.total += amount;
      } else {
        spendByVendor.set(key, { vendorId: p.vendorId, businessName: p.vendor.businessName, currency: p.currency, total: amount });
      }
    }
    const topVendors = Array.from(spendByVendor.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    return {
      currency: account.currency,
      digestFrequency: account.reportDigestFrequency,
      properties: {
        total: properties.length,
        byStatus: this.countByStatus(properties as { status: string }[]),
        totalEstimatedValue: properties.reduce(
          (sum: number, p: { estimatedValue: unknown }) => sum + Number(p.estimatedValue ?? 0),
          0,
        ),
      },
      projects: {
        total: projects.length,
        byStatus: this.countByStatus(projects as { status: string }[]),
      },
      maintenance: {
        total: maintenanceRequests.length,
        open: maintenanceRequests.filter((m: { status: string }) => m.status === 'open' || m.status === 'in_progress').length,
        resolved: maintenanceRequests.filter((m: { status: string }) => m.status === 'resolved').length,
      },
      inspections: {
        total: inspections.length,
        scheduled: inspections.filter((i: { status: string }) => i.status === 'scheduled').length,
        pass: countResult('pass'),
        needsAttention: countResult('needs_attention'),
        fail: countResult('fail'),
      },
      vendorSpendByCurrency: Array.from(spendByCurrency, ([currency, total]) => ({ currency, total })),
      topVendors,
    };
  }

  // The export half of "the rest of the Reports module" — a real
  // spreadsheet a landlord can open, not just the dashboard's own
  // numbers restated. Two tables in one CSV (blank line between) since
  // plain CSV has no concept of sheets: the actual property list (the
  // atomic data worth pivoting/filtering yourself), then the same
  // summary totals the dashboard itself shows, so the file stands alone
  // without needing the dashboard open alongside it.
  async getPortfolioOverviewCsv(accountId: string): Promise<string> {
    const [account, properties, overview] = await Promise.all([
      this.prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { currency: true } }),
      this.prisma.property.findMany({
        where: { accountId },
        select: { name: true, addressLine: true, city: true, propertyType: true, status: true, estimatedValue: true },
        orderBy: { name: 'asc' },
      }),
      this.getPortfolioOverview(accountId),
    ]);

    const lines: string[] = [];
    lines.push('Properties');
    lines.push(csvRow(['Name', 'Address', 'City', 'Type', 'Status', `Estimated value (${account.currency})`]));
    for (const p of properties) {
      lines.push(
        csvRow([p.name, p.addressLine, p.city ?? '', p.propertyType, p.status, p.estimatedValue?.toString() ?? '']),
      );
    }
    lines.push('');
    lines.push('Summary');
    lines.push(csvRow(['Metric', 'Value']));
    lines.push(csvRow(['Total properties', overview.properties.total]));
    lines.push(csvRow([`Total estimated value (${account.currency})`, overview.properties.totalEstimatedValue]));
    lines.push(csvRow(['Total projects', overview.projects.total]));
    lines.push(csvRow(['Open maintenance requests', overview.maintenance.open]));
    lines.push(csvRow(['Resolved maintenance requests', overview.maintenance.resolved]));
    lines.push(csvRow(['Inspections passed', overview.inspections.pass]));
    lines.push(csvRow(['Inspections needing attention', overview.inspections.needsAttention]));
    lines.push(csvRow(['Inspections failed', overview.inspections.fail]));
    for (const v of overview.vendorSpendByCurrency) {
      lines.push(csvRow([`Total vendor spend (${v.currency})`, v.total]));
    }
    return lines.join('\r\n');
  }

  async setDigestSubscription(accountId: string, frequency: string) {
    if (!DIGEST_FREQUENCIES.includes(frequency as (typeof DIGEST_FREQUENCIES)[number])) {
      throw new BadRequestException(`frequency must be one of: ${DIGEST_FREQUENCIES.join(', ')}`);
    }
    return this.prisma.account.update({ where: { id: accountId }, data: { reportDigestFrequency: frequency } });
  }

  // Shared by sendDigest (manual "send me one now") and
  // ReportsSchedulerService's own @Cron job — building the email body
  // once here means the scheduled version can never drift from what a
  // manual send (and therefore what's actually verifiable without
  // waiting for the cron to fire) produces.
  private async buildDigestEmail(accountId: string) {
    const [account, overview] = await Promise.all([
      this.prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { name: true, currency: true } }),
      this.getPortfolioOverview(accountId),
    ]);
    const subject = `Your PropertyOnTheGo portfolio digest — ${account.name}`;
    const lines = [
      `${overview.properties.total} propert${overview.properties.total === 1 ? 'y' : 'ies'} (${overview.currency} ${overview.properties.totalEstimatedValue.toLocaleString()} total estimated value)`,
      `${overview.projects.total} project(s)`,
      `${overview.maintenance.open} open maintenance request(s), ${overview.maintenance.resolved} resolved`,
      `${overview.inspections.pass} inspection(s) passed, ${overview.inspections.needsAttention} need attention, ${overview.inspections.fail} failed`,
    ];
    const text = `Your portfolio, ${account.name}:\n\n${lines.map((l) => `- ${l}`).join('\n')}`;
    const html = `<p>Your portfolio, <strong>${account.name}</strong>:</p><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`;
    return { subject, text, html };
  }

  // Emails every member of the account — same "notify whoever's actually
  // behind this account" reasoning AccountsService.
  // linkMatchingLeasesForNewTenant already uses for the tenant-signup
  // notification, since an account can have more than one member even
  // though the seeded demo data never does. Always updates
  // reportDigestLastSentAt, whether this was triggered manually or by
  // the cron — a manual send counts as "sent" for scheduling purposes
  // too, so a account that just asked for one on-demand doesn't also get
  // the automatic one a day later.
  async sendDigest(accountId: string) {
    const { subject, text, html } = await this.buildDigestEmail(accountId);
    const members = await this.prisma.accountMember.findMany({
      where: { accountId },
      include: { user: { select: { email: true } } },
    });
    for (const member of members) {
      const sent = await this.email.send({ to: member.user.email, subject, html, text });
      this.logger.log(`Portfolio digest for account ${accountId} — ${member.user.email} ${sent ? '(emailed)' : this.email.isConfigured ? '(email send failed — see the EmailService error above)' : '(would be emailed, no RESEND_API_KEY configured)'}`);
    }
    await this.prisma.account.update({ where: { id: accountId }, data: { reportDigestLastSentAt: new Date() } });
    return { sent: true, recipients: members.length };
  }

  // The @Cron job's own query — accounts opted in whose last send (or
  // account creation, if never sent) is at least a full period old. Plain
  // day-count thresholds, not a real calendar ("weekly" = 7+ days since,
  // "monthly" = 30+), same order-of-magnitude approximation
  // summarize_lease_status's own FREQUENCY_DAYS already uses.
  async findAccountsDueForDigest(): Promise<string[]> {
    const now = Date.now();
    const THRESHOLD_DAYS: Record<string, number> = { weekly: 7, monthly: 30 };
    const accounts = await this.prisma.account.findMany({
      where: { reportDigestFrequency: { in: ['weekly', 'monthly'] } },
      select: { id: true, reportDigestFrequency: true, reportDigestLastSentAt: true, createdAt: true },
    });
    return accounts
      .filter((a) => {
        const thresholdDays = THRESHOLD_DAYS[a.reportDigestFrequency] ?? THRESHOLD_DAYS.monthly;
        const anchor = a.reportDigestLastSentAt ?? a.createdAt;
        return (now - anchor.getTime()) / (1000 * 60 * 60 * 24) >= thresholdDays;
      })
      .map((a) => a.id);
  }
}
