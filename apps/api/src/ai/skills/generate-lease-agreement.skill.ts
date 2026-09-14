import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

// The audit's own finding on Workflow 8: "Lease agreement is uploaded or
// generated — Upload: real, via Document.leaseId. Generation (template,
// e-sign) doesn't exist anywhere." E-signature stays out — a real
// third-party integration this scaffold doesn't attempt anywhere else
// either. Generation is real now: every fact (tenant, rent, term,
// deposit, the property's own address) comes straight from the real
// Lease/Property rows, same split every other draft skill in this
// registry uses — the LLM only writes the agreement's own prose around
// them.
//
// Deliberately keyed on the lease itself (moduleContextPrefix: "lease"),
// the first skill in this registry to be — every other lease-adjacent
// skill (summarize_lease_status) is keyed on the property, since it
// summarizes every lease at once. Reached directly via POST /ai/actions
// with moduleContext "lease:<id>", not through the generic AskAiPanel
// skill list (which only ever mounts one panel per property/project),
// same "call runAction directly from a purpose-built button" shape
// generate_project_scope already established.
export const generateLeaseAgreementSkill: AiSkill = {
  key: 'generate_lease_agreement',
  label: 'Generate a lease agreement',
  requiredPermission: 'lease:write',
  moduleContextPrefix: 'lease',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma, llm }) {
    const leaseId = moduleContext.split(':')[1];
    const lease = await prisma.lease.findFirst({
      where: { id: leaseId, property: { accountId: ctx.accountId } },
      include: { property: true },
    });
    if (!lease) throw new NotFoundException('Lease not found');

    const location = [lease.property.addressLine, lease.property.city, lease.property.country].filter(Boolean).join(', ');
    const termText = lease.endDate
      ? `starts ${lease.startDate.toISOString().slice(0, 10)}, ends ${lease.endDate.toISOString().slice(0, 10)}`
      : `starts ${lease.startDate.toISOString().slice(0, 10)}, open-ended`;

    const agreement = await llm.complete({
      systemPrompt:
        'You write a real, structured residential tenancy/lease agreement in plain, formal English, using only the facts given. Include clearly labeled sections: Parties, Property, Term, Rent, Security Deposit, and standard tenant/landlord obligations (upkeep, access, termination notice). Do not invent any figure, date, or term not given below — where something ordinarily belongs in a lease but is not provided (e.g. notice period), write "[to be specified]" rather than making one up. No hedging or disclaimers outside the document itself.',
      userPrompt: `Property: ${location}. Tenant: ${lease.tenantName}${lease.tenantEmail ? ` (${lease.tenantEmail})` : ''}. Rent: ${Number(lease.rentAmount).toLocaleString()} ${lease.currency} per ${lease.rentFrequency} period. Term: ${termText}. Security deposit: ${lease.depositAmount ? `${Number(lease.depositAmount).toLocaleString()} ${lease.currency}` : 'none recorded'}.`,
    });

    return {
      draftLabel: 'Lease agreement — draft',
      items: [
        agreement,
        `${lease.tenantName} — ${Number(lease.rentAmount).toLocaleString()} ${lease.currency}/${lease.rentFrequency}`,
        'Accepting this draft saves it as a real document attached to this lease.',
      ],
      warn: false,
    };
  },
};
