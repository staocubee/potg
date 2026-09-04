import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

const UPCOMING_END_WARNING_DAYS = 60;

// Same 30-day "monthly" approximation summarize_lease_status already uses
// for its own overdue check — not a real calendar, just enough to flag
// "longer than one rent period since the last payment."
const FREQUENCY_DAYS: Record<string, number> = { weekly: 7, monthly: 30, annually: 365 };

// The tenant-facing counterpart to summarize_lease_status — that skill
// reads a property's full lease history for its owner; this reads the
// one lease the caller's own account is linked to (Lease.tenantAccountId,
// see TenantService.findMyLease), scoped by ctx.accountId rather than a
// moduleContext id since there's nothing else for a tenant to pass — its
// own account already names the one lease it can ever see.
export const summarizeMyTenancySkill: AiSkill = {
  key: 'summarize_my_tenancy',
  label: 'Summarize my tenancy',
  requiredPermission: 'lease:read',
  moduleContextPrefix: 'tenant',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, _moduleContext, _input, { prisma, llm }) {
    const lease = await prisma.lease.findFirst({
      where: { tenantAccountId: ctx.accountId },
      include: {
        property: { select: { name: true, addressLine: true } },
        rentPayments: { orderBy: { periodEnd: 'desc' } },
      },
    });
    if (!lease) {
      throw new NotFoundException('No lease is linked to this account yet — ask your landlord to link it');
    }

    const openMaintenance = await prisma.maintenanceRequest.count({
      where: { leaseId: lease.id, status: { in: ['open', 'in_progress'] } },
    });

    const periodDays = FREQUENCY_DAYS[lease.rentFrequency] ?? FREQUENCY_DAYS.monthly;
    const anchor =
      lease.rentPayments.length > 0
        ? new Date(Math.max(...lease.rentPayments.map((p) => p.periodEnd.getTime())))
        : lease.startDate;
    const overdueDays = Math.floor((Date.now() - anchor.getTime()) / (1000 * 60 * 60 * 24) - periodDays);
    const isOverdue = lease.status === 'active' && overdueDays > 0;

    const endingSoon =
      lease.status === 'active' &&
      lease.endDate != null &&
      (lease.endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24) <= UPCOMING_END_WARNING_DAYS;

    const totalPaid = lease.rentPayments.reduce((sum, p) => sum + Number(p.amount), 0);

    const items: string[] = [
      `${lease.property?.name ?? 'Property'}${lease.property?.addressLine ? ` (${lease.property.addressLine})` : ''}`,
      `Rent: ${Number(lease.rentAmount).toLocaleString()} ${lease.currency}/${lease.rentFrequency}, status: ${lease.status}`,
      lease.rentPayments.length > 0
        ? `${lease.rentPayments.length} payment(s) recorded, ${totalPaid.toLocaleString()} ${lease.currency} total`
        : 'No rent payments recorded yet',
      isOverdue ? `Rent looks ~${overdueDays} day(s) overdue` : 'Rent looks current',
      lease.endDate
        ? `Lease ends ${lease.endDate.toISOString().slice(0, 10)}${endingSoon ? ' — within the next 60 days' : ''}`
        : 'Open-ended lease, no end date on file',
      openMaintenance > 0
        ? `${openMaintenance} open maintenance request(s) on this tenancy`
        : 'No open maintenance requests',
    ];

    const summary = await llm.complete({
      systemPrompt:
        'You summarize a tenant\'s own lease for them in one short, plain, factual sentence — mention if rent looks overdue or the lease is ending soon. No hedging, no jargon, and never suggest they contact anyone other than their own landlord.',
      userPrompt: `Tenancy at ${items[0]}. ${items.slice(1).join('; ')}.`,
    });

    return {
      draftLabel: 'My tenancy — draft',
      items: [summary, ...items],
      warn: isOverdue || endingSoon,
    };
  },
};
