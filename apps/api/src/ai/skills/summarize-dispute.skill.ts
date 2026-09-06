import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { AiSkillInputSchema } from './ai-skill-input-schema';

// Module 20 Phase 1's "AI dispute summary" — one of the six named AI
// features this registry didn't already cover (the other eight already
// existed: summarize_property, generate_listing_description,
// estimate_project_budget, boq_to_order, verify_property_documents,
// compare_vendor_quotes, summarize_project/narrate_report, and the five
// assess_*_risk skills together already covering "AI risk summary").
// Works for both project and order disputes (Module 18's own
// generalization) — a saved ReportDefinition-style required `disputeId`
// input, same "which one" problem narrate_report already solved, since
// an account can have several disputes and moduleContext alone can't
// say which.
const SUMMARIZE_DISPUTE_INPUT_SCHEMA: AiSkillInputSchema = {
  type: 'object',
  properties: {
    disputeId: { type: 'string', description: 'The id of the dispute to summarize (see GET .../disputes).' },
  },
  required: ['disputeId'],
};

export const summarizeDisputeSkill: AiSkill = {
  key: 'summarize_dispute',
  label: 'Summarize a dispute',
  requiredPermission: 'dispute:read',
  moduleContextPrefix: 'account',
  inputSchema: SUMMARIZE_DISPUTE_INPUT_SCHEMA,

  async run(ctx, moduleContext, input, { prisma, llm }) {
    const requestedAccountId = moduleContext.split(':')[1];
    if (requestedAccountId !== ctx.accountId) {
      throw new BadRequestException('A dispute can only be summarized for your own account');
    }

    const disputeId = input.disputeId as string;
    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        evidence: { orderBy: { createdAt: 'asc' } },
        project: { select: { accountId: true } },
        order: { select: { accountId: true, supplier: { select: { accountId: true } } } },
      },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');

    // Duplicated party check, not a PaymentsService import — see
    // AiSkillDeps' own comment on why `reports` is the one exception to
    // "duplicate, don't share": this is a small, read-only check, not a
    // 100+ line cross-module computation, so it doesn't clear that bar.
    let isParty = false;
    if (dispute.project) {
      if (dispute.project.accountId === ctx.accountId) {
        isParty = true;
      } else {
        const vendor = await prisma.vendor.findUnique({ where: { accountId: ctx.accountId } });
        if (vendor) {
          const assignment = await prisma.projectVendorAssignment.findFirst({
            where: { projectId: dispute.projectId!, vendorId: vendor.id },
          });
          if (assignment) isParty = true;
        }
      }
    } else if (dispute.order) {
      if (dispute.order.accountId === ctx.accountId || dispute.order.supplier.accountId === ctx.accountId) {
        isParty = true;
      }
    }
    if (!isParty) throw new NotFoundException('Dispute not found');

    const facts = [
      `Type: ${dispute.disputeType.replace(/_/g, ' ')}`,
      `Status: ${dispute.status.replace(/_/g, ' ')}`,
      `Reason given: ${dispute.reason}`,
      dispute.resolutionNotes ? `Resolution notes: ${dispute.resolutionNotes}` : null,
      dispute.evidence.length > 0
        ? `Evidence submitted (${dispute.evidence.length}): ${dispute.evidence.map((e) => e.note).join('; ')}`
        : 'No evidence submitted yet.',
    ]
      .filter((line): line is string => line != null)
      .join('. ');

    const summary = await llm.complete({
      systemPrompt:
        "You summarize a platform dispute — its type, current status, reason, and any evidence submitted — in one short, plain-language paragraph for a party trying to catch up on it. Be factual and neutral, never take a side on who's right.",
      userPrompt: facts,
    });

    return {
      draftLabel: 'Dispute summary — draft',
      items: [summary, ...dispute.evidence.map((e) => `Evidence: ${e.note}`)],
      warn: dispute.status === 'open' || dispute.status === 'under_review',
    };
  },
};
