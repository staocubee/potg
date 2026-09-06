import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

// Module 6's risk-flag pattern (see assess_listing_risk's own comment),
// extended to vendors — the last sub-piece of "the rest of risk flags
// beyond listings/projects/leases." Public/buyer-facing like
// assess_listing_risk and explain_vendor_trust_score, not filtered by
// ctx.accountId: anyone browsing the vendor marketplace can ask whether a
// vendor carries any flagged risk factors before hiring them.
//
// Deliberately a separate skill from explain_vendor_trust_score, not a
// replacement — same split assess_listing_risk/summarize_listing already
// draws: explain_vendor_trust_score narrates the whole score in prose;
// this produces a flat, explicit flag list, and reuses the same
// underlying signals (verification, disputes, the platform's own audit,
// license expiry) rather than recomputing a different set from scratch.
export const assessVendorRiskSkill: AiSkill = {
  key: 'assess_vendor_risk',
  label: 'Assess vendor risk',
  requiredPermission: 'vendor:read',
  moduleContextPrefix: 'vendor',
  inputSchema: NO_INPUT_SCHEMA,

  async run(_ctx, moduleContext, _input, { prisma, llm }) {
    const vendorId = moduleContext.split(':')[1];
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const [openDisputes, latestAudit] = await Promise.all([
      prisma.dispute.count({
        where: { status: { in: ['open', 'under_review'] }, project: { assignments: { some: { vendorId } } } },
      }),
      prisma.vendorTrustAudit.findFirst({ where: { vendorId }, orderBy: { createdAt: 'desc' } }),
    ]);

    const flags: string[] = [];
    if (vendor.verificationStatus !== 'verified') {
      flags.push(`Vendor verification status is "${vendor.verificationStatus}", not verified`);
    }
    if (openDisputes > 0) {
      flags.push(`${openDisputes} open dispute(s) on projects this vendor is assigned to`);
    }
    if (vendor.licenseExpiresAt != null && vendor.licenseExpiresAt.getTime() < Date.now()) {
      flags.push('Listed professional license has expired');
    }
    if (latestAudit?.rating === 'major_concerns') {
      flags.push("Most recent platform audit rated \"major concerns\"");
    } else if (latestAudit?.rating === 'minor_concerns') {
      flags.push("Most recent platform audit rated \"minor concerns\"");
    }

    const summary = await llm.complete({
      systemPrompt:
        "You explain a vendor's risk factors to a prospective customer in one short, plain-language paragraph. Be factual and neutral, never alarmist, and never claim to confirm or deny fraud.",
      userPrompt:
        flags.length === 0
          ? `Vendor "${vendor.businessName}" has no flagged risk factors from the platform's own checks.`
          : `Vendor "${vendor.businessName}" has these flagged risk factors: ${flags.join('; ')}.`,
    });

    return {
      draftLabel: 'Vendor risk assessment — draft',
      items: [summary, ...(flags.length ? flags : ["No risk factors flagged by the platform's own checks."])],
      warn: flags.length > 0,
    };
  },
};
