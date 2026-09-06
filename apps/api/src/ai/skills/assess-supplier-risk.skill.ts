import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

// The materials-marketplace counterpart to assess_vendor_risk — same
// public/buyer-facing shape, swapped for supplier-appropriate signals:
// cancelled orders stand in for open disputes (suppliers have no
// Dispute-equivalent model — see materials/trust-score.ts's own comment
// on cancelledOrders for why that's the closest analogue).
export const assessSupplierRiskSkill: AiSkill = {
  key: 'assess_supplier_risk',
  label: 'Assess supplier risk',
  requiredPermission: 'supplier:read',
  moduleContextPrefix: 'supplier',
  inputSchema: NO_INPUT_SCHEMA,

  async run(_ctx, moduleContext, _input, { prisma, llm }) {
    const supplierId = moduleContext.split(':')[1];
    const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new NotFoundException('Supplier not found');

    const [cancelledOrders, latestAudit] = await Promise.all([
      prisma.order.count({ where: { supplierId, status: 'cancelled' } }),
      prisma.supplierTrustAudit.findFirst({ where: { supplierId }, orderBy: { createdAt: 'desc' } }),
    ]);

    const flags: string[] = [];
    if (supplier.verificationStatus !== 'verified') {
      flags.push(`Supplier verification status is "${supplier.verificationStatus}", not verified`);
    }
    if (cancelledOrders > 0) {
      flags.push(`${cancelledOrders} cancelled order(s) on record`);
    }
    if (latestAudit?.rating === 'major_concerns') {
      flags.push("Most recent platform audit rated \"major concerns\"");
    } else if (latestAudit?.rating === 'minor_concerns') {
      flags.push("Most recent platform audit rated \"minor concerns\"");
    }

    const summary = await llm.complete({
      systemPrompt:
        "You explain a supplier's risk factors to a prospective buyer in one short, plain-language paragraph. Be factual and neutral, never alarmist, and never claim to confirm or deny fraud.",
      userPrompt:
        flags.length === 0
          ? `Supplier "${supplier.businessName}" has no flagged risk factors from the platform's own checks.`
          : `Supplier "${supplier.businessName}" has these flagged risk factors: ${flags.join('; ')}.`,
    });

    return {
      draftLabel: 'Supplier risk assessment — draft',
      items: [summary, ...(flags.length ? flags : ["No risk factors flagged by the platform's own checks."])],
      warn: flags.length > 0,
    };
  },
};
