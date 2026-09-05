import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

const UPCOMING_END_WARNING_DAYS = 60;

// Same 30-day-per-month approximation summarize_lease_status already
// uses for "does this lease look overdue" — not for anything financial.
const FREQUENCY_DAYS: Record<string, number> = { weekly: 7, monthly: 30, annually: 365 };

type LeaseWithPayments = {
  id: string;
  status: string;
  tenantName: string;
  endDate: Date | null;
  startDate: Date;
  rentFrequency: string;
  rentPayments: { periodEnd: Date }[];
};

function overdueDays(lease: LeaseWithPayments, now: number): number | null {
  const periodDays = FREQUENCY_DAYS[lease.rentFrequency] ?? FREQUENCY_DAYS.monthly;
  const anchor =
    lease.rentPayments.length > 0
      ? new Date(Math.max(...lease.rentPayments.map((p) => new Date(p.periodEnd).getTime())))
      : lease.startDate;
  const daysSinceAnchor = (now - anchor.getTime()) / (1000 * 60 * 60 * 24);
  const overdue = Math.floor(daysSinceAnchor - periodDays);
  return overdue > 0 ? overdue : null;
}

// Module 6's risk-flag pattern (see assess_listing_risk's own comment),
// extended to leases — the second sub-piece of "the rest of risk flags/
// trust scores beyond listings and vendors/suppliers." Scoped at the
// property level, not per-lease, same moduleContextPrefix
// summarize_lease_status already uses — a property can carry more than
// one lease over time, and "which leases here need attention" is the
// actual owner-facing question, not "is this one lease risky" in
// isolation.
//
// Deliberately a separate skill from summarize_lease_status, not a
// replacement — same split assess_listing_risk/summarize_listing already
// draws for listings: summarize_lease_status narrates the whole tenancy
// picture in prose; this produces a flat, explicit per-lease flag list.
export const assessLeaseRiskSkill: AiSkill = {
  key: 'assess_lease_risk',
  label: 'Assess lease/tenant risk',
  requiredPermission: 'lease:read',
  moduleContextPrefix: 'property',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma, llm }) {
    const propertyId = moduleContext.split(':')[1];
    const property = await prisma.property.findFirst({ where: { id: propertyId, accountId: ctx.accountId } });
    if (!property) throw new NotFoundException('Property not found');

    const leases = await prisma.lease.findMany({
      where: { propertyId, status: 'active' },
      include: { rentPayments: { select: { periodEnd: true } } },
      orderBy: { startDate: 'desc' },
    });

    const now = Date.now();
    const flags: string[] = [];

    for (const lease of leases as unknown as LeaseWithPayments[]) {
      const overdue = overdueDays(lease, now);
      if (overdue != null) {
        flags.push(`${lease.tenantName}: rent looks ~${overdue} day(s) overdue`);
      }
      if (lease.endDate && (lease.endDate.getTime() - now) / (1000 * 60 * 60 * 24) <= UPCOMING_END_WARNING_DAYS) {
        flags.push(`${lease.tenantName}: lease ending within ${UPCOMING_END_WARNING_DAYS} days, no renewal on record`);
      }
    }

    const summary = await llm.complete({
      systemPrompt:
        "You explain a property's tenant/lease risk factors to its owner in one short, plain-language paragraph. Be factual and neutral, focused on what needs attention.",
      userPrompt:
        flags.length === 0
          ? `Property "${property.name}" has no flagged lease/tenant risk factors from the platform's own checks.`
          : `Property "${property.name}" has these flagged lease/tenant risk factors: ${flags.join('; ')}.`,
    });

    return {
      draftLabel: 'Lease/tenant risk assessment — draft',
      items: [summary, ...(flags.length ? flags : ["No risk factors flagged by the platform's own checks."])],
      warn: flags.length > 0,
    };
  },
};
