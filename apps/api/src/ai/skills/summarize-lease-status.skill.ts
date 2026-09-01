import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

const UPCOMING_END_WARNING_DAYS = 60;

// Module 13's AI Assistance action — every number here (active vs. ended
// leases, rent collected, days until a lease's own endDate) is computed
// deterministically from Lease/LeaseRentPayment; the LLM only phrases the
// opening line, same split as summarize_property and
// summarize_inspection_history.
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
      endDate: Date | null;
      rentPayments: { amount: unknown }[];
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
        'You summarize a property\'s lease status for its owner in one plain, factual sentence — mention if a lease is ending soon. No hedging, no jargon.',
      userPrompt: `Property "${property.name}": ${active.length} active lease(s) of ${leases.length} total, ${endingSoon.length} ending within ${UPCOMING_END_WARNING_DAYS} days, total rent collected on record: ${totalCollected.toLocaleString()}.`,
    });
    items.push(intro);

    for (const lease of active) {
      const paid = lease.rentPayments.reduce((s, p) => s + Number(p.amount), 0);
      const endText = lease.endDate
        ? ` — ends ${lease.endDate.toISOString().slice(0, 10)}`
        : ' — open-ended';
      items.push(
        `${lease.tenantName}: ${Number(lease.rentAmount).toLocaleString()} ${lease.currency}/${lease.rentFrequency}${endText}, ${lease.rentPayments.length} payment(s) recorded (${paid.toLocaleString()} ${lease.currency} total)`,
      );
    }
    if (endingSoon.length > 0) {
      items.push(`${endingSoon.length} lease(s) ending within ${UPCOMING_END_WARNING_DAYS} days — worth reaching out about renewal.`);
    }

    return {
      draftLabel: 'Lease status — draft',
      items,
      warn: endingSoon.length > 0,
    };
  },
};
