import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

  private countByStatus(items: { status: string }[]) {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
    return Array.from(counts, ([status, count]) => ({ status, count }));
  }

  async getPortfolioOverview(accountId: string) {
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { currency: true } });

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
}
