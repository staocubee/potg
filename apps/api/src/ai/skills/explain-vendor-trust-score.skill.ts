import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';
import { getVendorTrustScore } from '../../vendors/trust-score';

// Module 6's "chat to explain a trust score" — public/buyer-facing like
// assess_listing_risk, not filtered by ctx.accountId: anyone browsing the
// vendor marketplace can ask why a vendor's score looks the way it does.
// Reuses vendors/trust-score.ts's exact formula so this never drifts from
// what GET /vendors/:id itself returns.
export const explainVendorTrustScoreSkill: AiSkill = {
  key: 'explain_vendor_trust_score',
  label: 'Explain vendor trust score',
  requiredPermission: 'vendor:read',
  moduleContextPrefix: 'vendor',
  inputSchema: NO_INPUT_SCHEMA,

  async run(_ctx, moduleContext, _input, { prisma, llm }) {
    const vendorId = moduleContext.split(':')[1];
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const trustScore = await getVendorTrustScore(prisma, vendor);
    const { score, band, factors } = trustScore;

    const items: string[] = [
      `Verification: ${factors.verificationStatus.replace(/_/g, ' ')}`,
      factors.ratingAverage != null
        ? `Average rating: ${factors.ratingAverage.toFixed(1)}/5 across ${factors.reviewCount} review(s)`
        : `No reviews yet`,
      `${factors.completedProjects} completed project(s) on record`,
      factors.disputeCount > 0
        ? `${factors.disputeCount} dispute(s) on record from projects this vendor worked`
        : `No disputes on record`,
    ];

    const summary = await llm.complete({
      systemPrompt:
        "You explain a vendor's trust score to a prospective customer in one short, plain-language paragraph. Be factual and neutral — this is the platform's own arithmetic over its own data, not an independent audit, so never claim it proves the vendor is trustworthy or not.",
      userPrompt: `Vendor "${vendor.businessName}" has a trust score of ${score}/100 (${band}). Factors: ${items.join('; ')}.`,
    });

    return {
      draftLabel: 'Vendor trust score — draft',
      items: [summary, `Score: ${score}/100 (${band})`, ...items],
      warn: band === 'caution',
    };
  },
};
