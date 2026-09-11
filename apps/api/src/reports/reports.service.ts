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
  // --- Module 24: Reports and Analytics -------------------------------
  //
  // Real, user-supplied scope: 17 named reports across Owner/Company/
  // Marketplace categories. Property portfolio summary and document
  // status report were already covered by the metrics above; these 5
  // new keys close the property expense report, rental income report,
  // vendor performance report (which doubles as "vendor job completion"
  // — the same underlying data, Company and Marketplace categories both
  // naming it), and supplier sales / material order trends — all
  // computed from real data that already existed (payouts, rent
  // payments, vendor assignments/reviews, orders) but had never been
  // aggregated into a report before. See getPortfolioOverview's own
  // comment on each new group for what's genuinely new vs already
  // tracked, and the README for what this pass explicitly didn't reach
  // (branch/facility reports — no Branch entity exists; asset
  // utilization — RentalBooking only tracks this account renting *from*
  // suppliers, not utilization of its own assets; listing performance/
  // inquiry conversion — a real, buildable gap, cut to keep this pass
  // bounded).
  property_expenses: {
    label: 'Property expense report (project spend)',
    rows: (o) => o.propertyExpenses.map((p) => ({ label: `${p.propertyName} — spend (${p.currency})`, value: p.total })),
  },
  property_rental_income: {
    label: 'Rental income report',
    rows: (o) => o.propertyRentalIncome.map((p) => ({ label: `${p.propertyName} — rent collected (${p.currency})`, value: p.total })),
  },
  vendor_performance: {
    label: 'Vendor performance report',
    rows: (o) =>
      o.vendorPerformance.flatMap((v) => [
        { label: `${v.businessName} — jobs completed`, value: `${v.jobsCompleted}/${v.jobsAssigned}` },
        ...(v.avgRating != null ? [{ label: `${v.businessName} — avg rating`, value: v.avgRating.toFixed(1) }] : []),
      ]),
  },
  supplier_sales: {
    label: 'Supplier sales report',
    rows: (o) =>
      o.supplierSales.flatMap((s) => [
        { label: `${s.businessName} — orders`, value: s.orderCount },
        { label: `${s.businessName} — spend (${s.currency})`, value: s.total },
      ]),
  },
  material_order_trends: {
    label: 'Material order trends (last 90 days)',
    rows: (o) => o.materialOrderTrends.map((m) => ({ label: `${m.productName} — ${m.quantity} unit(s) (${m.currency})`, value: m.total })),
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

    const [
      properties,
      projects,
      maintenanceRequests,
      inspections,
      payouts,
      documents,
      activeLeases,
      paymentsOverview,
      vendorAssignments,
      vendorReviews,
      orders,
      allRentPayments,
    ] = await Promise.all([
      this.prisma.property.findMany({ where: { accountId }, select: { id: true, name: true, status: true, estimatedValue: true } }),
      this.prisma.project.findMany({ where: { accountId }, select: { status: true } }),
      this.prisma.maintenanceRequest.findMany({ where: { property: { accountId } }, select: { status: true } }),
      this.prisma.propertyInspection.findMany({ where: { property: { accountId } }, select: { status: true, overallResult: true } }),
      // grossAmount, not amount — every "spend"/"expense" figure derived
      // from this query is the owner's own perspective (what did I pay
      // out in total), which the platform's own fee cut (see
      // src/payments/platform-fee.ts) never reduces — that fee only
      // affects the vendor's own net take-home, tracked separately on
      // each Payout row.
      this.prisma.payout.findMany({
        where: { project: { accountId }, status: { not: 'failed' } },
        select: {
          grossAmount: true,
          currency: true,
          vendorId: true,
          vendor: { select: { businessName: true } },
          project: { select: { propertyId: true } },
        },
      }),
      this.prisma.document.findMany({ where: { accountId }, select: { verificationStatus: true } }),
      this.prisma.lease.findMany({
        where: { property: { accountId }, status: 'active' },
        select: {
          rentFrequency: true,
          startDate: true,
          rentPayments: { select: { periodEnd: true } },
        },
      }),
      this.payments.getAccountOverview(accountId),
      // Module 24's "Vendor performance report" (Company) and "Vendor job
      // completion" (Marketplace) — the same underlying question (how did
      // the vendors this account has worked with actually perform), so one
      // metric group answers both named reports rather than building two
      // near-identical ones.
      this.prisma.projectVendorAssignment.findMany({
        where: { project: { accountId } },
        select: { vendorId: true, vendor: { select: { businessName: true } }, project: { select: { status: true } } },
      }),
      // This account's own reviews of vendors it has worked with — not
      // the vendor's platform-wide trust score rating (VendorTrustAudit/
      // getVendorRiskFlags already cover that, per-vendor), this owner's
      // own experience specifically.
      this.prisma.vendorReview.findMany({ where: { accountId }, select: { vendorId: true, rating: true } }),
      // Module 24's "Supplier sales report" and "Material order trends" —
      // reframed honestly as this account's own view of what it has
      // bought and from whom, not a supplier's own sales dashboard: this
      // whole Reports feature has only ever been scoped to an owning
      // account's own portfolio (see this method's own top-of-file
      // comment), and Order.accountId is the *buying* account. A
      // supplier's own sales dashboard would need a parallel
      // supplier-accountId-scoped view of this same data — out of scope
      // here.
      this.prisma.order.findMany({
        where: { accountId },
        select: {
          supplierId: true,
          supplier: { select: { businessName: true } },
          status: true,
          totalAmount: true,
          currency: true,
          createdAt: true,
          items: { select: { productId: true, quantity: true, lineTotal: true, product: { select: { name: true } } } },
        },
      }),
      // Rental income report — deliberately every lease this account's
      // properties have ever had, not just the currently-active ones
      // `activeLeases` above is scoped to (that scoping is right for
      // "is rent currently overdue," which only makes sense for a lease
      // still running, but wrong for "how much rent has this property
      // actually brought in" — a lease that already ended still
      // collected real rent while it ran, and excluding it would
      // understate income for no good reason).
      this.prisma.leaseRentPayment.findMany({
        where: { lease: { property: { accountId } } },
        select: { amount: true, currency: true, lease: { select: { propertyId: true } } },
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
    for (const p of payouts as { grossAmount: unknown; currency: string; vendorId: string; vendor: { businessName: string } }[]) {
      const amount = Number(p.grossAmount);
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

    const propertyNameById = new Map((properties as { id: string; name: string }[]).map((p) => [p.id, p.name]));

    // Property expense report — real payout spend, grouped by
    // (property, currency) instead of the account-wide-only totals
    // spendByCurrency/topVendors above already gave. Payout has no
    // propertyId of its own — every payout belongs to a project, and
    // every project belongs to one property, so this reaches it through
    // that join rather than adding a denormalized field for a value
    // that's always derivable.
    const expenseByProperty = new Map<string, { propertyId: string; propertyName: string; currency: string; total: number }>();
    for (const p of payouts as { grossAmount: unknown; currency: string; project: { propertyId: string } }[]) {
      const propertyId = p.project.propertyId;
      const key = `${propertyId}:${p.currency}`;
      const existing = expenseByProperty.get(key);
      const amount = Number(p.grossAmount);
      if (existing) {
        existing.total += amount;
      } else {
        expenseByProperty.set(key, {
          propertyId,
          propertyName: propertyNameById.get(propertyId) ?? 'Unknown property',
          currency: p.currency,
          total: amount,
        });
      }
    }

    // Rental income report — LeaseRentPayment has existed since Module 13
    // and was, until now, only ever read to decide whether rent looks
    // overdue (isLeaseOverdue above, active leases only) — never summed
    // as income, and income itself shouldn't be scoped to active leases
    // only (see allRentPayments' own comment above).
    const incomeByProperty = new Map<string, { propertyId: string; propertyName: string; currency: string; total: number }>();
    for (const payment of allRentPayments as { amount: unknown; currency: string; lease: { propertyId: string } }[]) {
      const propertyId = payment.lease.propertyId;
      const key = `${propertyId}:${payment.currency}`;
      const existing = incomeByProperty.get(key);
      const amount = Number(payment.amount);
      if (existing) {
        existing.total += amount;
      } else {
        incomeByProperty.set(key, {
          propertyId,
          propertyName: propertyNameById.get(propertyId) ?? 'Unknown property',
          currency: payment.currency,
          total: amount,
        });
      }
    }

    // Vendor performance report — jobs assigned/completed per vendor,
    // this account's own average rating of each (not the vendor's
    // platform-wide trust score), and total spend (reusing spendByVendor
    // above rather than a second pass over payouts).
    const vendorJobs = new Map<string, { vendorId: string; businessName: string; assigned: number; completed: number }>();
    for (const a of vendorAssignments as { vendorId: string; vendor: { businessName: string }; project: { status: string } }[]) {
      const existing = vendorJobs.get(a.vendorId);
      const isCompleted = a.project.status === 'completed';
      if (existing) {
        existing.assigned += 1;
        if (isCompleted) existing.completed += 1;
      } else {
        vendorJobs.set(a.vendorId, { vendorId: a.vendorId, businessName: a.vendor.businessName, assigned: 1, completed: isCompleted ? 1 : 0 });
      }
    }
    const ratingsByVendor = new Map<string, number[]>();
    for (const r of vendorReviews as { vendorId: string; rating: number }[]) {
      const list = ratingsByVendor.get(r.vendorId) ?? [];
      list.push(r.rating);
      ratingsByVendor.set(r.vendorId, list);
    }
    const vendorPerformance = Array.from(vendorJobs.values()).map((v) => {
      const ratings = ratingsByVendor.get(v.vendorId) ?? [];
      return {
        vendorId: v.vendorId,
        businessName: v.businessName,
        jobsAssigned: v.assigned,
        jobsCompleted: v.completed,
        avgRating: ratings.length > 0 ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : null,
      };
    });

    // Supplier sales report (this account's own buying history — see the
    // orders query's own comment on the "sales" reframing).
    const supplierAgg = new Map<string, { supplierId: string; businessName: string; currency: string; orderCount: number; total: number }>();
    for (const o of orders as { supplierId: string; supplier: { businessName: string }; totalAmount: unknown; currency: string }[]) {
      const key = `${o.supplierId}:${o.currency}`;
      const existing = supplierAgg.get(key);
      const amount = Number(o.totalAmount);
      if (existing) {
        existing.orderCount += 1;
        existing.total += amount;
      } else {
        supplierAgg.set(key, { supplierId: o.supplierId, businessName: o.supplier.businessName, currency: o.currency, orderCount: 1, total: amount });
      }
    }
    const supplierSales = Array.from(supplierAgg.values()).sort((a, b) => b.total - a.total);

    // Material order trends — top 10 products by spend across orders
    // placed in the last 90 days, the one metric group in this pass that
    // genuinely needs a "top N" cap (product catalogs/order histories can
    // get large; every other new group here is naturally small — this
    // account's own properties/vendors/suppliers).
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const productAgg = new Map<string, { productId: string; productName: string; currency: string; quantity: number; total: number }>();
    for (const o of orders as {
      createdAt: Date;
      currency: string;
      items: { productId: string; quantity: number; lineTotal: unknown; product: { name: string } }[];
    }[]) {
      if (o.createdAt.getTime() < ninetyDaysAgo) continue;
      for (const item of o.items) {
        const key = `${item.productId}:${o.currency}`;
        const existing = productAgg.get(key);
        const lineTotal = Number(item.lineTotal);
        if (existing) {
          existing.quantity += item.quantity;
          existing.total += lineTotal;
        } else {
          productAgg.set(key, { productId: item.productId, productName: item.product.name, currency: o.currency, quantity: item.quantity, total: lineTotal });
        }
      }
    }
    const materialOrderTrends = Array.from(productAgg.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

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
      propertyExpenses: Array.from(expenseByProperty.values()),
      propertyRentalIncome: Array.from(incomeByProperty.values()),
      vendorPerformance,
      supplierSales,
      materialOrderTrends,
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
