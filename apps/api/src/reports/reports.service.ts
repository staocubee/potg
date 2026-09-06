import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';
import { PaymentsService } from '../payments/payments.service';
import { getVendorRiskFlags } from '../vendors/trust-score';
import { getSupplierRiskFlags } from '../materials/trust-score';
import { getProjectRiskFlags } from '../projects/risk-flags';
import { getPropertyLeaseRiskFlags } from '../properties/lease-risk-flags';

// Same 30-day-per-month approximation summarize_lease_status
// (ai/skills/summarize-lease-status.skill.ts) already uses for "does this
// lease look overdue" — not for anything financial, just deciding
// whether more than one rent period has passed since the last recorded
// payment (or since the lease started, if none has ever been recorded).
// Duplicated rather than imported: this codebase's established
// convention for near-identical logic used in two different contexts
// (compare VendorTrustAudit/SupplierTrustAudit) is a parallel copy with
// a cross-reference comment, not a shared helper — and the account-wide
// version here has nothing else in common with that skill's own
// per-property, LLM-narrated shape.
const RENT_FREQUENCY_DAYS: Record<string, number> = { weekly: 7, monthly: 30, annually: 365 };
function isLeaseOverdue(lease: { rentFrequency: string; startDate: Date; rentPayments: { periodEnd: Date }[] }): boolean {
  const periodDays = RENT_FREQUENCY_DAYS[lease.rentFrequency] ?? RENT_FREQUENCY_DAYS.monthly;
  const anchor =
    lease.rentPayments.length > 0
      ? new Date(Math.max(...lease.rentPayments.map((p) => new Date(p.periodEnd).getTime())))
      : lease.startDate;
  const daysSinceAnchor = (Date.now() - anchor.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceAnchor - periodDays > 0;
}

const DIGEST_FREQUENCIES = ['off', 'weekly', 'monthly'] as const;

type PortfolioOverview = Awaited<ReturnType<ReportsService['getPortfolioOverview']>>;
type MetricRow = { label: string; value: string | number };

// The report builder's entire "query engine": each key projects one or
// more {label, value} rows out of the ONE getPortfolioOverview
// computation already run for the fixed dashboard — never a second,
// independent query path. A saved ReportDefinition is just an ordered
// list of these keys; running or exporting it means computing the
// overview once and picking rows out of it, not building or executing a
// dynamic query per report. Deliberately not a general query
// builder/DSL — every metric here is something the dashboard or digest
// email already surfaces elsewhere, just individually selectable and
// combinable now.
const METRIC_REGISTRY: Record<string, { label: string; rows: (o: PortfolioOverview) => MetricRow[] }> = {
  properties_total: { label: 'Total properties', rows: (o) => [{ label: 'Total properties', value: o.properties.total }] },
  properties_total_value: {
    label: 'Total estimated value',
    rows: (o) => [{ label: `Total estimated value (${o.currency})`, value: o.properties.totalEstimatedValue }],
  },
  properties_by_status: {
    label: 'Properties by status',
    rows: (o) => o.properties.byStatus.map((s) => ({ label: `Properties — ${s.status}`, value: s.count })),
  },
  projects_total: { label: 'Total projects', rows: (o) => [{ label: 'Total projects', value: o.projects.total }] },
  projects_by_status: {
    label: 'Projects by status',
    rows: (o) => o.projects.byStatus.map((s) => ({ label: `Projects — ${s.status}`, value: s.count })),
  },
  maintenance_total: { label: 'Total maintenance requests', rows: (o) => [{ label: 'Total maintenance requests', value: o.maintenance.total }] },
  maintenance_open: { label: 'Open maintenance requests', rows: (o) => [{ label: 'Open maintenance requests', value: o.maintenance.open }] },
  maintenance_resolved: { label: 'Resolved maintenance requests', rows: (o) => [{ label: 'Resolved maintenance requests', value: o.maintenance.resolved }] },
  inspections_total: { label: 'Total inspections', rows: (o) => [{ label: 'Total inspections', value: o.inspections.total }] },
  inspections_scheduled: { label: 'Inspections scheduled', rows: (o) => [{ label: 'Inspections scheduled', value: o.inspections.scheduled }] },
  inspections_results: {
    label: 'Inspection results',
    rows: (o) => [
      { label: 'Inspections passed', value: o.inspections.pass },
      { label: 'Inspections needing attention', value: o.inspections.needsAttention },
      { label: 'Inspections failed', value: o.inspections.fail },
    ],
  },
  vendor_spend_by_currency: {
    label: 'Vendor spend by currency',
    rows: (o) => o.vendorSpendByCurrency.map((v) => ({ label: `Vendor spend (${v.currency})`, value: v.total })),
  },
  top_vendors: {
    label: 'Top 5 vendors by spend',
    rows: (o) => o.topVendors.map((v) => ({ label: `Top vendor: ${v.businessName} (${v.currency})`, value: v.total })),
  },
  // Payments — reuses PaymentsService.getAccountOverview (injected into
  // ReportsService) rather than recomputing escrow/deposit/release
  // grouping a second time; this is the one metric group actually pulled
  // from another module's own service method, not a new Prisma query.
  payments_open_disputes: {
    label: 'Open disputes',
    rows: (o) => [{ label: 'Open disputes (payments)', value: o.paymentsOpenDisputeCount }],
  },
  payments_deposited_by_currency: {
    label: 'Total deposited by currency',
    rows: (o) => o.paymentsDepositedByCurrency.map((d) => ({ label: `Deposited (${d.currency})`, value: d.total })),
  },
  payments_released_by_currency: {
    label: 'Total released by currency',
    rows: (o) => o.paymentsReleasedByCurrency.map((r) => ({ label: `Released (${r.currency})`, value: r.total })),
  },
  payments_escrow_balance_by_currency: {
    label: 'Current escrow balance by currency',
    rows: (o) => o.paymentsEscrowByCurrency.map((e) => ({ label: `Escrow balance (${e.currency})`, value: e.balance })),
  },
  // Documents
  documents_total: { label: 'Total documents', rows: (o) => [{ label: 'Total documents', value: o.documents.total }] },
  documents_by_verification_status: {
    label: 'Documents by verification status',
    rows: (o) => o.documents.byStatus.map((s) => ({ label: `Documents — ${s.status}`, value: s.count })),
  },
  // Tenant/leases
  tenant_active_leases: { label: 'Active leases', rows: (o) => [{ label: 'Active leases', value: o.leases.active }] },
  tenant_overdue_leases: {
    label: 'Leases with rent overdue',
    rows: (o) => [{ label: 'Leases with rent overdue', value: o.leases.overdue }],
  },
};

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
    private readonly payments: PaymentsService,
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

    const [properties, projects, maintenanceRequests, inspections, payouts, documents, activeLeases, paymentsOverview] = await Promise.all([
      this.prisma.property.findMany({ where: { accountId }, select: { status: true, estimatedValue: true } }),
      this.prisma.project.findMany({ where: { accountId }, select: { status: true } }),
      this.prisma.maintenanceRequest.findMany({ where: { property: { accountId } }, select: { status: true } }),
      this.prisma.propertyInspection.findMany({ where: { property: { accountId } }, select: { status: true, overallResult: true } }),
      this.prisma.payout.findMany({
        where: { project: { accountId }, status: { not: 'failed' } },
        select: { amount: true, currency: true, vendorId: true, vendor: { select: { businessName: true } } },
      }),
      this.prisma.document.findMany({ where: { accountId }, select: { verificationStatus: true } }),
      this.prisma.lease.findMany({
        where: { property: { accountId }, status: 'active' },
        select: { rentFrequency: true, startDate: true, rentPayments: { select: { periodEnd: true } } },
      }),
      this.payments.getAccountOverview(accountId),
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
      documents: {
        total: documents.length,
        byStatus: this.countByStatus(documents.map((d: { verificationStatus: string }) => ({ status: d.verificationStatus }))),
      },
      leases: {
        active: activeLeases.length,
        overdue: (activeLeases as { rentFrequency: string; startDate: Date; rentPayments: { periodEnd: Date }[] }[]).filter(isLeaseOverdue)
          .length,
      },
      paymentsOpenDisputeCount: paymentsOverview.openDisputeCount,
      paymentsDepositedByCurrency: paymentsOverview.depositedByCurrency,
      paymentsReleasedByCurrency: paymentsOverview.releasedByCurrency,
      paymentsEscrowByCurrency: paymentsOverview.escrowByCurrency,
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

  // The cross-portfolio "show every at-risk record" view the README used
  // to flag as missing — every assess_*_risk AI skill only ever answers
  // for one record at a time, reachable only through that record's own
  // Ask AI panel. This answers "what across my whole account needs
  // attention right now" in one call, across all four entity types that
  // have a risk-flag skill. Started as vendors/suppliers only
  // (getAtRiskPartners); renamed and extended to projects/leases in the
  // same pass rather than adding a second, near-identical endpoint —
  // "partners" never fit projects/leases anyway, since those are the
  // account's own assets, not external parties it works with. "Work
  // with" for vendors/suppliers still means: a vendor with a
  // ProjectVendorAssignment on one of this account's own projects, or a
  // supplier this account has placed at least one Order with — not the
  // whole marketplace. Every flag list reuses its skill's own shared
  // helper word-for-word (getProjectRiskFlags, getPropertyLeaseRiskFlags,
  // getVendorRiskFlags, getSupplierRiskFlags) — see those functions' own
  // comments for why each is a shared helper rather than this codebase's
  // usual "duplicate with a cross-reference comment" convention.
  async getAtRiskOverview(accountId: string) {
    const [projects, propertiesWithLeases, assignedVendors, orderedSuppliers] = await Promise.all([
      this.prisma.project.findMany({
        where: { accountId },
        select: { id: true, title: true, budget: true, currency: true, status: true },
      }),
      this.prisma.property.findMany({
        where: { accountId, leases: { some: { status: 'active' } } },
        select: { id: true, name: true },
      }),
      this.prisma.vendor.findMany({
        where: { assignments: { some: { project: { accountId } } } },
        select: { id: true, businessName: true, verificationStatus: true, licenseExpiresAt: true },
      }),
      this.prisma.supplier.findMany({
        where: { orders: { some: { accountId } } },
        select: { id: true, businessName: true, verificationStatus: true },
      }),
    ]);

    const [projectFlags, leaseFlags, vendorFlags, supplierFlags] = await Promise.all([
      Promise.all(projects.map(async (p) => ({ id: p.id, label: p.title, flags: await getProjectRiskFlags(this.prisma, p) }))),
      Promise.all(
        propertiesWithLeases.map(async (p) => ({ id: p.id, label: p.name, flags: await getPropertyLeaseRiskFlags(this.prisma, p.id) })),
      ),
      Promise.all(assignedVendors.map(async (v) => ({ id: v.id, label: v.businessName, flags: await getVendorRiskFlags(this.prisma, v) }))),
      Promise.all(
        orderedSuppliers.map(async (s) => ({ id: s.id, label: s.businessName, flags: await getSupplierRiskFlags(this.prisma, s) })),
      ),
    ]);

    return {
      projects: { total: projects.length, atRisk: projectFlags.filter((p) => p.flags.length > 0) },
      leases: { total: propertiesWithLeases.length, atRisk: leaseFlags.filter((p) => p.flags.length > 0) },
      vendors: { total: assignedVendors.length, atRisk: vendorFlags.filter((v) => v.flags.length > 0) },
      suppliers: { total: orderedSuppliers.length, atRisk: supplierFlags.filter((s) => s.flags.length > 0) },
    };
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

  // --- Report builder ------------------------------------------------
  //
  // "A real report builder — only one fixed report shape exists" — the
  // gap this closes. Not a dynamic query engine: METRIC_REGISTRY above is
  // the entire vocabulary, and a saved definition is just which of those
  // keys to include and in what order.

  listMetrics() {
    return Object.entries(METRIC_REGISTRY).map(([key, { label }]) => ({ key, label }));
  }

  private validateMetrics(metrics: unknown): string[] {
    if (!Array.isArray(metrics) || metrics.length === 0) {
      throw new BadRequestException('metrics must be a non-empty array of metric keys');
    }
    for (const key of metrics) {
      if (typeof key !== 'string' || !METRIC_REGISTRY[key]) {
        throw new BadRequestException(`Unknown metric key: ${key} — see GET /reports/metrics for valid keys`);
      }
    }
    return metrics as string[];
  }

  createDefinition(accountId: string, name: string, metrics: unknown) {
    const validated = this.validateMetrics(metrics);
    return this.prisma.reportDefinition.create({ data: { accountId, name, metrics: validated } });
  }

  findDefinitions(accountId: string) {
    return this.prisma.reportDefinition.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' } });
  }

  private async requireDefinition(accountId: string, id: string) {
    const definition = await this.prisma.reportDefinition.findUnique({ where: { id } });
    if (!definition || definition.accountId !== accountId) {
      throw new NotFoundException('Report definition not found');
    }
    return definition;
  }

  async deleteDefinition(accountId: string, id: string) {
    await this.requireDefinition(accountId, id);
    await this.prisma.reportDefinition.delete({ where: { id } });
    return { deleted: true };
  }

  // Compute the ONE overview, then project every saved metric key out of
  // it — the "compute once, project down" split named in this section's
  // own comment above, not a query per metric.
  async runDefinition(accountId: string, id: string) {
    const definition = await this.requireDefinition(accountId, id);
    const overview = await this.getPortfolioOverview(accountId);
    const metrics = definition.metrics as string[];
    const rows = metrics.flatMap((key) => METRIC_REGISTRY[key]?.rows(overview) ?? []);
    return { name: definition.name, generatedAt: new Date().toISOString(), rows };
  }

  async exportDefinitionCsv(accountId: string, id: string): Promise<string> {
    const { rows } = await this.runDefinition(accountId, id);
    const lines = [csvRow(['Metric', 'Value']), ...rows.map((r) => csvRow([r.label, r.value]))];
    return lines.join('\r\n');
  }
}
