import { PrismaService } from '../prisma/prisma.service';

const UPCOMING_END_WARNING_DAYS = 60;

// Same 30-day-per-month approximation summarize_lease_status
// (ai/skills/summarize-lease-status.skill.ts) and reports.service.ts's own
// isLeaseOverdue already use — not for anything financial, just deciding
// whether more than one rent period has passed since the last recorded
// payment.
const FREQUENCY_DAYS: Record<string, number> = { weekly: 7, monthly: 30, annually: 365 };

type LeaseForRiskCheck = {
  tenantName: string;
  endDate: Date | null;
  startDate: Date;
  rentFrequency: string;
  rentPayments: { periodEnd: Date }[];
};

function overdueDays(lease: LeaseForRiskCheck, now: number): number | null {
  const periodDays = FREQUENCY_DAYS[lease.rentFrequency] ?? FREQUENCY_DAYS.monthly;
  const anchor =
    lease.rentPayments.length > 0
      ? new Date(Math.max(...lease.rentPayments.map((p) => new Date(p.periodEnd).getTime())))
      : lease.startDate;
  const daysSinceAnchor = (now - anchor.getTime()) / (1000 * 60 * 60 * 24);
  const overdue = Math.floor(daysSinceAnchor - periodDays);
  return overdue > 0 ? overdue : null;
}

// The flag list assess_lease_risk (the AI skill) and
// ReportsService.getAtRiskOverview (the cross-portfolio dashboard view)
// both need word-for-word identical — same reasoning
// vendors/trust-score.ts's own getVendorRiskFlags already documents.
// Scoped at the property level, not per-lease, same reason
// assess_lease_risk itself is: a property can carry more than one active
// lease, and "which of this property's leases need attention" is the
// real owner-facing question, so the flag list (and the cross-portfolio
// view's own row) is per-property, with each flag string naming its own
// tenant.
export async function getPropertyLeaseRiskFlags(prisma: PrismaService, propertyId: string): Promise<string[]> {
  const leases = await prisma.lease.findMany({
    where: { propertyId, status: 'active' },
    include: { rentPayments: { select: { periodEnd: true } } },
    orderBy: { startDate: 'desc' },
  });

  const now = Date.now();
  const flags: string[] = [];

  for (const lease of leases as unknown as LeaseForRiskCheck[]) {
    const overdue = overdueDays(lease, now);
    if (overdue != null) {
      flags.push(`${lease.tenantName}: rent looks ~${overdue} day(s) overdue`);
    }
    if (lease.endDate && (lease.endDate.getTime() - now) / (1000 * 60 * 60 * 24) <= UPCOMING_END_WARNING_DAYS) {
      flags.push(`${lease.tenantName}: lease ending within ${UPCOMING_END_WARNING_DAYS} days, no renewal on record`);
    }
  }

  return flags;
}
