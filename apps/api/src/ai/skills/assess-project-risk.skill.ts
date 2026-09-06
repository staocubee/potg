import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';
import { getProjectRiskFlags } from '../../projects/risk-flags';

// Module 6's risk-flag pattern (see assess_listing_risk's own comment),
// extended to projects — the first sub-piece of "the rest of risk flags/
// trust scores beyond listings and vendors/suppliers" the README used to
// flag as open. Unlike assess_listing_risk, this IS account-scoped
// (ctx.accountId): a project has no public/buyer-facing angle the way a
// marketplace listing does — nobody outside the owning account (and its
// assigned vendor, through a different route) has any business asking
// whether this project looks risky.
//
// Deliberately a separate skill from summarize_project, not a
// replacement for it — same split assess_listing_risk/summarize_listing
// already draws for listings: summarize_project narrates overall health
// in prose; this one produces a flat, explicit flag list a caller (human
// or otherwise) can act on without parsing a paragraph. The flags
// themselves come from getProjectRiskFlags (projects/risk-flags.ts) —
// shared with ReportsService.getAtRiskOverview, the cross-portfolio
// dashboard view, so both surfaces show byte-identical wording for the
// same project.
export const assessProjectRiskSkill: AiSkill = {
  key: 'assess_project_risk',
  label: 'Assess project risk',
  requiredPermission: 'project:read',
  moduleContextPrefix: 'project',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma, llm }) {
    const projectId = moduleContext.split(':')[1];
    const project = await prisma.project.findFirst({ where: { id: projectId, accountId: ctx.accountId } });
    if (!project) throw new NotFoundException('Project not found');

    const flags = await getProjectRiskFlags(prisma, project);

    const summary = await llm.complete({
      systemPrompt:
        "You explain a renovation/construction project's risk factors to its owner in one short, plain-language paragraph. Be factual and neutral, focused on what needs attention.",
      userPrompt:
        flags.length === 0
          ? `Project "${project.title}" has no flagged risk factors from the platform's own checks.`
          : `Project "${project.title}" has these flagged risk factors: ${flags.join('; ')}.`,
    });

    return {
      draftLabel: 'Project risk assessment — draft',
      items: [summary, ...(flags.length ? flags : ["No risk factors flagged by the platform's own checks."])],
      warn: flags.length > 0,
    };
  },
};
