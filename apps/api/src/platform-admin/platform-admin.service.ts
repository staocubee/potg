import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Module 16-24's "admin operations" bucket, scoped to its one genuinely
// buildable slice — see PlatformAdminAction's own schema comment for why
// this is a distinct job from ComplianceService/platform_reviewer's own
// work, not a rename of either. Every method here is genuinely
// platform-wide, like ComplianceService already is: no accountId scoping
// anywhere, gated purely by account:read_all/account:suspend (which only
// platform_admin carries — see seed.ts).
@Injectable()
export class PlatformAdminService {
  constructor(private readonly prisma: PrismaService) {}

  // The directory itself — nothing on this platform could previously see
  // every account that exists in one place. Health signals kept
  // deliberately minimal and honestly computable for every AccountType
  // (INDIVIDUAL/FAMILY/COMPANY/VENDOR/SUPPLIER/TENANT alike) — no
  // "last activity" signal, since nothing on Account itself tracks that
  // (updatedAt only moves when the account row itself changes, not on
  // general use, so surfacing it as "last activity" would be misleading).
  async listAccounts() {
    const accounts = await this.prisma.account.findMany({
      select: {
        id: true,
        name: true,
        accountType: true,
        status: true,
        createdAt: true,
        _count: { select: { members: true } },
      },
    });

    return accounts
      .map((a) => ({
        id: a.id,
        name: a.name,
        accountType: a.accountType,
        status: a.status,
        memberCount: a._count.members,
        createdAt: a.createdAt,
      }))
      .sort((a, b) => {
        if (a.status === 'suspended' && b.status !== 'suspended') return -1;
        if (a.status !== 'suspended' && b.status === 'suspended') return 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
  }

  // The nav audit's own finding on the Platform Admin Sidebar:
  // "Properties / Listings — missing, no property/listing management
  // routes for admin at all." Deliberately a read-only directory, the
  // same "see everything in one place, act only where real levers
  // already exist" shape listAccounts above already established — no
  // new edit/suspend action on a property or listing here; those stay
  // the owning account's own or, for listing verification specifically,
  // platform_reviewer's (a distinct role — see the audit's own note
  // that platform_admin and platform_reviewer aren't interchangeable).
  async listProperties() {
    const properties = await this.prisma.property.findMany({
      select: {
        id: true,
        name: true,
        addressLine: true,
        city: true,
        country: true,
        propertyType: true,
        status: true,
        createdAt: true,
        account: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return properties;
  }

  async listListings() {
    const listings = await this.prisma.propertyListing.findMany({
      select: {
        id: true,
        title: true,
        listingType: true,
        askingPrice: true,
        currency: true,
        status: true,
        verificationStatus: true,
        createdAt: true,
        account: { select: { id: true, name: true } },
        property: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return listings;
  }

  // The nav audit's own finding on the Platform Admin Sidebar:
  // "Transactions — missing as a ledger — only an aggregate 'Marketplace
  // GMV' dollar total, not a transaction count/list." Itemizes the exact
  // same two real sources getPlatformReports' own GMV figure already
  // sums (delivered orders, paid-out milestones) — same definition, no
  // new modeling decision, just the individual rows instead of one
  // summed number per currency.
  async listTransactions() {
    const [orders, payouts] = await Promise.all([
      this.prisma.order.findMany({
        where: { status: 'delivered' },
        select: {
          id: true,
          totalAmount: true,
          currency: true,
          updatedAt: true,
          account: { select: { id: true, name: true } },
          supplier: { select: { businessName: true } },
          delivery: { select: { deliveredAt: true } },
        },
      }),
      this.prisma.payout.findMany({
        where: { status: 'paid' },
        select: {
          id: true,
          grossAmount: true,
          currency: true,
          paidAt: true,
          createdAt: true,
          vendor: { select: { businessName: true } },
          project: { select: { id: true, title: true, account: { select: { id: true, name: true } } } },
        },
      }),
    ]);

    const transactions = [
      ...orders.map((o) => ({
        id: o.id,
        type: 'order' as const,
        amount: o.totalAmount,
        currency: o.currency,
        occurredAt: o.delivery?.deliveredAt ?? o.updatedAt,
        counterparty: o.supplier?.businessName ?? 'Supplier',
        account: o.account,
      })),
      ...payouts.map((p) => ({
        id: p.id,
        type: 'payout' as const,
        amount: p.grossAmount,
        currency: p.currency,
        occurredAt: p.paidAt ?? p.createdAt,
        counterparty: p.vendor?.businessName ?? 'Vendor',
        account: p.project?.account ?? null,
      })),
    ];

    return transactions.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  }

  // The nav audit's own finding on the Platform Admin Sidebar: "Escrow —
  // missing as its own page — only an aggregate stat tile." Every real
  // EscrowAccount row platform-wide, the exact same rows
  // getPlatformReports' own escrow-volume figure already sums (no
  // status filter there either — a closed account's balance still
  // counted, so this doesn't filter to "active" here).
  async listEscrowAccounts() {
    const accounts = await this.prisma.escrowAccount.findMany({
      select: {
        id: true,
        balance: true,
        currency: true,
        status: true,
        createdAt: true,
        project: { select: { id: true, title: true, account: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return accounts;
  }

  private async requireAccount(accountId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  // The actual lever the directory exists to point at. Blocks suspending
  // the caller's own acting account — a cheap, real safeguard against a
  // platform_admin accidentally locking itself out (AccountContextGuard
  // would then refuse every request acting as that account, this one
  // included, with no path back in short of a direct database fix).
  async suspendAccount(targetAccountId: string, reason: string, actorAccountId: string, actorUserId: string) {
    if (targetAccountId === actorAccountId) {
      throw new BadRequestException('You cannot suspend the account you are currently acting as');
    }
    const account = await this.requireAccount(targetAccountId);
    if (account.status === 'suspended') {
      throw new BadRequestException('This account is already suspended');
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.account.update({ where: { id: targetAccountId }, data: { status: 'suspended' } }),
      this.prisma.platformAdminAction.create({
        data: { targetAccountId, action: 'suspend', reason, performedByUserId: actorUserId },
      }),
    ]);
    return updated;
  }

  async reinstateAccount(targetAccountId: string, reason: string, actorUserId: string) {
    const account = await this.requireAccount(targetAccountId);
    if (account.status !== 'suspended') {
      throw new BadRequestException('This account is not currently suspended');
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.account.update({ where: { id: targetAccountId }, data: { status: 'active' } }),
      this.prisma.platformAdminAction.create({
        data: { targetAccountId, action: 'reinstate', reason, performedByUserId: actorUserId },
      }),
    ]);
    return updated;
  }

  // Module 24's "Platform Admin Reports" bucket — the one category the
  // Reports module itself never covers, by design: ReportsService.
  // getPortfolioOverview is account-scoped on purpose ("never a second,
  // independent query path" — see METRIC_REGISTRY's own comment), so
  // platform-wide analytics belongs here instead, alongside the rest of
  // this service's own genuinely-platform-wide work. Seven real numbers,
  // not seven stubs — each documented below with exactly what it does
  // and doesn't count, since "GMV"/"escrow volume"/"dispute rate" are
  // each a real modeling choice, not a self-evident query.
  async getPlatformReports() {
    const [
      activeUsers,
      totalProperties,
      deliveredOrders,
      paidPayouts,
      completedDeposits,
      escrowAccounts,
      vendorAssignments,
      vendorReviews,
      disputes,
      totalProjects,
      totalOrders,
      pendingVendors,
      pendingSuppliers,
      submittedListings,
      submittedDocuments,
      pendingIdentity,
    ] = await Promise.all([
      this.prisma.user.count({ where: { status: 'active' } }),
      this.prisma.property.count(),
      this.prisma.order.findMany({ where: { status: 'delivered' }, select: { totalAmount: true, currency: true } }),
      this.prisma.payout.findMany({ where: { status: 'paid' }, select: { grossAmount: true, platformFeeAmount: true, currency: true } }),
      this.prisma.payment.findMany({ where: { status: 'completed' }, select: { amount: true, currency: true } }),
      this.prisma.escrowAccount.findMany({ select: { balance: true, currency: true } }),
      this.prisma.projectVendorAssignment.findMany({
        select: { vendorId: true, vendor: { select: { businessName: true } }, project: { select: { status: true } } },
      }),
      this.prisma.vendorReview.findMany({ select: { vendorId: true, rating: true } }),
      this.prisma.dispute.findMany({ select: { status: true } }),
      this.prisma.project.count(),
      this.prisma.order.count(),
      this.prisma.vendor.count({ where: { verificationStatus: 'pending' } }),
      this.prisma.supplier.count({ where: { verificationStatus: 'pending' } }),
      this.prisma.propertyListing.count({ where: { verificationStatus: 'submitted' } }),
      this.prisma.document.count({ where: { verificationStatus: 'submitted' } }),
      this.prisma.user.count({ where: { identityVerificationStatus: 'pending' } }),
    ]);

    // Marketplace GMV — real completed transactions only (delivered
    // orders, paid-out milestones), never askingPrice on an active
    // listing or a pending/processing row. Deliberately excludes
    // property-listing sales: a listing's own status can reach "sold",
    // but nothing on PropertyListing records the actual closing price
    // (askingPrice is an ask, not a confirmed sale amount, and no
    // Payment/Payout ties to a listing sale in this schema) — including
    // it would mean inventing a number, not reporting one. Grouped by
    // currency, never summed across currencies, same convention every
    // other money aggregate in this codebase already follows.
    const gmvByCurrency = new Map<string, number>();
    for (const o of deliveredOrders) gmvByCurrency.set(o.currency, (gmvByCurrency.get(o.currency) ?? 0) + Number(o.totalAmount));
    for (const p of paidPayouts) gmvByCurrency.set(p.currency, (gmvByCurrency.get(p.currency) ?? 0) + Number(p.grossAmount));

    // Platform revenue — the Platform Admin Dashboard's own finding:
    // "Revenue reports — no platform-revenue aggregate exists anywhere
    // — only a per-payout fee shown on the vendor's own row." Real
    // money this codebase already tracks per payout
    // (Payout.platformFeeAmount, the vendor's own take-home cut — see
    // that field's own schema comment) summed across every paid
    // payout, grouped by currency, same convention as every other money
    // aggregate here. Materials orders don't have an equivalent fee
    // yet (Order/Payment stay disconnected — the audit's own
    // still-open WF6 finding), so this is real project-milestone
    // platform revenue specifically, not "all platform revenue."
    const platformRevenueByCurrency = new Map<string, number>();
    for (const p of paidPayouts) platformRevenueByCurrency.set(p.currency, (platformRevenueByCurrency.get(p.currency) ?? 0) + Number(p.platformFeeAmount));

    // Escrow volume — two different real numbers, not one ambiguous
    // figure: lifetime inflow (every completed deposit, ever) vs. the
    // current snapshot (what's actually sitting in escrow right now
    // across every project). Both grouped by currency.
    const depositedByCurrency = new Map<string, number>();
    for (const d of completedDeposits) depositedByCurrency.set(d.currency, (depositedByCurrency.get(d.currency) ?? 0) + Number(d.amount));
    const currentBalanceByCurrency = new Map<string, number>();
    for (const e of escrowAccounts) currentBalanceByCurrency.set(e.currency, (currentBalanceByCurrency.get(e.currency) ?? 0) + Number(e.balance));

    // Vendor performance, platform-wide — same jobsAssigned/jobsCompleted/
    // avgRating definition ReportsService's own account-scoped version
    // uses (see getPortfolioOverview's vendorPerformance), just with no
    // accountId filter: every assignment and every review on the
    // platform, not one owner's own history with vendors it has hired.
    const vendorJobs = new Map<string, { vendorId: string; businessName: string; assigned: number; completed: number }>();
    for (const a of vendorAssignments) {
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
    for (const r of vendorReviews) {
      const list = ratingsByVendor.get(r.vendorId) ?? [];
      list.push(r.rating);
      ratingsByVendor.set(r.vendorId, list);
    }
    const vendorPerformance = Array.from(vendorJobs.values())
      .map((v) => {
        const ratings = ratingsByVendor.get(v.vendorId) ?? [];
        return { ...v, avgRating: ratings.length > 0 ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : null };
      })
      .sort((a, b) => b.completed - a.completed);
    const totalAssigned = vendorPerformance.reduce((sum, v) => sum + v.assigned, 0);
    const totalCompleted = vendorPerformance.reduce((sum, v) => sum + v.completed, 0);
    const allRatings = vendorPerformance.flatMap((v) => ratingsByVendor.get(v.vendorId) ?? []);

    // Dispute rate — disputes raised as a fraction of everything a
    // dispute can actually be raised against: every project and every
    // order, regardless of status. Deliberately NOT gated on success
    // (paid/delivered) the way GMV above is — a dispute is often raised
    // precisely *because* something didn't complete as expected
    // (Dispute.disputeType includes delayed_project, payment_disagreement,
    // material_delivery_issue), so requiring "completed" first would
    // silently exclude a real share of real disputes from the
    // denominator. Confirmed against this database directly: most
    // disputes here (10 of 13) are project-level with no specific
    // order/payout/milestone tied to them at all, which a
    // completed-transaction-only denominator would undercount even
    // further. Can still read as a large percentage on a small demo
    // dataset with disproportionately many test disputes relative to real
    // projects/orders — the raw counts alongside the rate are what make
    // that legible rather than misleading.
    const disputeStatusCounts = new Map<string, number>();
    for (const d of disputes) disputeStatusCounts.set(d.status, (disputeStatusCounts.get(d.status) ?? 0) + 1);
    const disputableCount = totalProjects + totalOrders;
    const disputeRate = disputableCount > 0 ? disputes.length / disputableCount : 0;

    // Verification backlog — every item on the platform currently
    // waiting on a platform_reviewer's own decision, broken out by type
    // rather than merged into one opaque count, since a reviewer needs
    // to know *what* to go look at, not just that something is pending.
    const verificationBacklog = {
      vendors: pendingVendors,
      suppliers: pendingSuppliers,
      listings: submittedListings,
      documents: submittedDocuments,
      identity: pendingIdentity,
      total: pendingVendors + pendingSuppliers + submittedListings + submittedDocuments + pendingIdentity,
    };

    return {
      generatedAt: new Date(),
      activeUsers,
      activeProperties: totalProperties,
      marketplaceGmvByCurrency: Array.from(gmvByCurrency, ([currency, total]) => ({ currency, total })),
      platformRevenueByCurrency: Array.from(platformRevenueByCurrency, ([currency, total]) => ({ currency, total })),
      escrowVolume: {
        totalDepositedByCurrency: Array.from(depositedByCurrency, ([currency, total]) => ({ currency, total })),
        currentBalanceByCurrency: Array.from(currentBalanceByCurrency, ([currency, total]) => ({ currency, total })),
      },
      vendorPerformance: {
        totalAssigned,
        totalCompleted,
        completionRate: totalAssigned > 0 ? totalCompleted / totalAssigned : 0,
        avgRating: allRatings.length > 0 ? allRatings.reduce((sum, r) => sum + r, 0) / allRatings.length : null,
        topVendors: vendorPerformance.slice(0, 10),
      },
      disputeRate: {
        rate: disputeRate,
        totalDisputes: disputes.length,
        disputableCount,
        byStatus: Array.from(disputeStatusCounts, ([status, count]) => ({ status, count })),
      },
      verificationBacklog,
    };
  }

  // The audit-log half — every suspend/reinstate action, most recent
  // first, with the target account's own current name resolved so this
  // reads as a real log rather than a table of raw ids. Capped at 200:
  // this is an operational log to scroll through, not something a query
  // parameter needs to page through yet.
  async getAuditLog() {
    const actions = await this.prisma.platformAdminAction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { targetAccount: { select: { name: true } } },
    });
    return actions.map((a) => ({
      id: a.id,
      targetAccountId: a.targetAccountId,
      targetAccountName: a.targetAccount.name,
      action: a.action,
      reason: a.reason,
      performedByUserId: a.performedByUserId,
      createdAt: a.createdAt,
    }));
  }
}
