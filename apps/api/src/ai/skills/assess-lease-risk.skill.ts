import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';
import { getPropertyLeaseRiskFlags } from '../../properties/lease-risk-flags';

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
// The flags themselves come from getPropertyLeaseRiskFlags
// (properties/lease-risk-flags.ts) — shared with
// ReportsService.getAtRiskOverview, the cross-portfolio dashboard view,
// so both surfaces show byte-identical wording for the same property.
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

    const flags = await getPropertyLeaseRiskFlags(prisma, propertyId);

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
