import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

const UPCOMING_END_WARNING_DAYS = 60;

// Approximate days per rent period, used only to decide whether a lease
// looks overdue — not for anything financial. "monthly" is a 30-day
// approximation (real months vary 28-31 days), same order-of-magnitude
// simplification the rest of this scaffold's date math already leans on
// (e.g. Document's 30-day "expiring soon" window).
const FREQUENCY_DAYS: Record<string, number> = { weekly: 7, monthly: 30, annually: 365 };

// Module 13's AI Assistance action — every number here (active vs. ended
// leases, rent collected, days until a lease's own endDate, whether rent
// looks overdue) is computed deterministically from Lease/LeaseRentPayment;
// the LLM only phrases the opening line, same split as summarize_property
// and summarize_inspection_history.
export const summarizeLeaseStatusSkill: AiSkill = {
  key: 'summarize_lease_status',
  label: 'Summarize lease status',
  requiredPermission: 'lease:read',
  moduleContextPrefix: 'property',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma, llm }) {
    const propertyId = moduleContext.split(':')[1];
    const property = await prisma.property.findFirst({
      where: { id: propertyId, accountId: ctx.accountId },
    });
    if (!property) throw new NotFoundException('Property not found');

    const leases = await prisma.lease.findMany({
      where: { propertyId },
      include: { rentPayments: true },
      orderBy: { startDate: 'desc' },
    });

    type LeaseWithPayments = {
      status: string;
      tenantName: string;
      rentAmount: unknown;
      currency: string;
      rentFrequency: string;
      startDate: Date;
      endDate: Date | null;
      rentPayments: { amount: unknown; periodEnd: Date }[];
    };
    const active = (leases as LeaseWithPayments[]).filter((l) => l.status === 'active');
    const now = Date.now();
    const endingSoon = active.filter(
      (l) => l.endDate && (l.endDate.getTime() - now) / (1000 * 60 * 60 * 24) <= UPCOMING_END_WARNING_DAYS,
    );
    const totalCollected = leases.reduce(
      (sum: number, l: LeaseWithPayments) => sum + l.rentPayments.reduce((s, p) => s + Number(p.amount), 0),
      0,
    );

    // "Overdue" here means: longer than one rent period has passed since
    // the last recorded payment's coverage ended (or since the lease
    // started, if no payment has ever been recorded) — the closest this
    // deterministic check gets to "a rent period has gone unpaid" without
    // a real payment/reminder system behind it.
    function overdueDays(lease: LeaseWithPayments): number | null {
      const periodDays = FREQUENCY_DAYS[lease.rentFrequency] ?? FREQUENCY_DAYS.monthly;
      const anchor =
        lease.rentPayments.length > 0
          ? new Date(Math.max(...lease.rentPayments.map((p) => new Date(p.periodEnd).getTime())))
          : lease.startDate;
      const daysSinceAnchor = (now - anchor.getTime()) / (1000 * 60 * 60 * 24);
      const overdue = Math.floor(daysSinceAnchor - periodDays);
      return overdue > 0 ? overdue : null;
    }
    const overdue = active
      .map((lease) => ({ lease, days: overdueDays(lease) }))
      .filter((x): x is { lease: LeaseWithPayments; days: number } => x.days !== null);

    const items: string[] = [];

    if (leases.length === 0) {
      const intro = await llm.complete({
        systemPrompt:
          'You tell a property owner in one short, plain sentence that no lease has been recorded for this property yet.',
        userPrompt: `Property "${property.name}" has zero leases on file.`,
      });
      return { draftLabel: 'Lease status — draft', items: [intro], warn: false };
    }

    const intro = await llm.complete({
      systemPrompt:
        'You summarize a property\'s lease status for its owner in one plain, factual sentence — mention if a lease is ending soon or if rent looks overdue. No hedging, no jargon.',
      userPrompt: `Property "${property.name}": ${active.length} active lease(s) of ${leases.length} total, ${endingSoon.length} ending within ${UPCOMING_END_WARNING_DAYS} days, ${overdue.length} with rent that looks overdue, total rent collected on record: ${totalCollected.toLocaleString()}.`,
    });
    items.push(intro);

    for (const lease of active) {
      const paid = lease.rentPayments.reduce((s, p) => s + Number(p.amount), 0);
      const endText = lease.endDate
        ? ` — ends ${lease.endDate.toISOString().slice(0, 10)}`
        : ' — open-ended';
      const overdueEntry = overdue.find((o) => o.lease === lease);
      const overdueText = overdueEntry ? ` — rent looks ~${overdueEntry.days} day(s) overdue` : '';
      items.push(
        `${lease.tenantName}: ${Number(lease.rentAmount).toLocaleString()} ${lease.currency}/${lease.rentFrequency}${endText}, ${lease.rentPayments.length} payment(s) recorded (${paid.toLocaleString()} ${lease.currency} total)${overdueText}`,
      );
    }
    if (endingSoon.length > 0) {
      items.push(`${endingSoon.length} lease(s) ending within ${UPCOMING_END_WARNING_DAYS} days — worth reaching out about renewal.`);
    }
    if (overdue.length > 0) {
      items.push(`${overdue.length} lease(s) with rent that looks overdue — worth following up.`);
    }

    return {
      draftLabel: 'Lease status — draft',
      items,
      warn: endingSoon.length > 0 || overdue.length > 0,
    };
  },
};
