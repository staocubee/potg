import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';
import { getSupplierRiskFlags } from '../../materials/trust-score';

// The materials-marketplace counterpart to assess_vendor_risk — same
// public/buyer-facing shape. The flags come from getSupplierRiskFlags
// (materials/trust-score.ts) — shared with ReportsService.getAtRiskPartners,
// the cross-portfolio dashboard view, so both surfaces show byte-identical
// wording for the same supplier.
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

    const flags = await getSupplierRiskFlags(prisma, supplier);

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
