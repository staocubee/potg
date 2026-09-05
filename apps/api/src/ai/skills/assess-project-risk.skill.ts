import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

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
// or otherwise) can act on without parsing a paragraph.
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

    const [assignments, milestones, payouts, openDisputes] = await Promise.all([
      prisma.projectVendorAssignment.findMany({ where: { projectId } }),
      prisma.projectMilestone.findMany({ where: { projectId } }),
      prisma.payout.findMany({ where: { projectId, status: { not: 'failed' } } }),
      prisma.dispute.findMany({ where: { projectId, status: { in: ['open', 'under_review'] } } }),
    ]);

    const flags: string[] = [];
    const now = new Date();

    const overdueMilestones = milestones.filter(
      (m: { dueDate: Date | null; status: string }) => m.dueDate && m.dueDate < now && m.status !== 'completed',
    );
    if (overdueMilestones.length > 0) {
      flags.push(`${overdueMilestones.length} milestone(s) overdue`);
    }

    if (openDisputes.length > 0) {
      flags.push(`${openDisputes.length} open dispute(s) on this project`);
    }

    const totalReleased = payouts.reduce((sum: number, p: { amount: unknown }) => sum + Number(p.amount), 0);
    const budget = project.budget != null ? Number(project.budget) : null;
    if (budget != null && budget > 0 && totalReleased > budget) {
      flags.push(
        `Released so far (${totalReleased.toLocaleString()} ${project.currency}) exceeds the project's own budget (${budget.toLocaleString()} ${project.currency})`,
      );
    }

    if (project.status === 'in_progress' && assignments.length === 0) {
      flags.push('Marked in progress but no vendor is assigned');
    }

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
