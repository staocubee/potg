import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';
import { getSupplierTrustScore } from '../../materials/trust-score';

// The materials-marketplace counterpart to explain_vendor_trust_score —
// same public/buyer-facing shape, reuses materials/trust-score.ts's exact
// formula so this never drifts from what GET /suppliers/:id returns.
export const explainSupplierTrustScoreSkill: AiSkill = {
  key: 'explain_supplier_trust_score',
  label: 'Explain supplier trust score',
  requiredPermission: 'supplier:read',
  moduleContextPrefix: 'supplier',
  inputSchema: NO_INPUT_SCHEMA,

  async run(_ctx, moduleContext, _input, { prisma, llm }) {
    const supplierId = moduleContext.split(':')[1];
    const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new NotFoundException('Supplier not found');

    const trustScore = await getSupplierTrustScore(prisma, supplier);
    const { score, band, factors } = trustScore;

    const items: string[] = [
      `Verification: ${factors.verificationStatus.replace(/_/g, ' ')}`,
      factors.ratingAverage != null
        ? `Average rating: ${factors.ratingAverage.toFixed(1)}/5 across ${factors.reviewCount} review(s)`
        : `No reviews yet`,
      `${factors.deliveredOrders} delivered order(s) on record`,
      factors.cancelledOrders > 0
        ? `${factors.cancelledOrders} cancelled order(s) on record`
        : `No cancelled orders on record`,
      factors.latestAudit
        ? `Most recent platform audit: ${factors.latestAudit.rating.replace(/_/g, ' ')} (${new Date(factors.latestAudit.createdAt).toLocaleDateString()})`
        : 'No platform audit on record yet',
      factors.identityVerifiedOperator
        ? "This supplier's own identity has been verified"
        : "This supplier's own identity has not been verified",
    ];

    const summary = await llm.complete({
      systemPrompt:
        "You explain a supplier's trust score to a prospective buyer in one short, plain-language paragraph. Be factual and neutral. Part of this score now comes from real signals (a platform reviewer's own audit, government ID verification), not only recomputed platform activity — you can say that plainly, but still never claim the score proves the supplier is trustworthy or not; it's one input among several a buyer should weigh themselves.",
      userPrompt: `Supplier "${supplier.businessName}" has a trust score of ${score}/100 (${band}). Factors: ${items.join('; ')}.`,
    });

    return {
      draftLabel: 'Supplier trust score — draft',
      items: [summary, `Score: ${score}/100 (${band})`, ...items],
      warn: band === 'caution',
    };
  },
};
