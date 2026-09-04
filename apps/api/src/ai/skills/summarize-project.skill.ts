import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

// The one project-level "give me the whole picture" summary that was
// missing — every other module got one (summarize_property,
// summarize_inspection_history, summarize_lease_status,
// summarize_maintenance_backlog), Module 9 never did.
// draft_project_status_update already covers stage progress and recent
// narrative updates, so this deliberately covers what that one doesn't:
// vendor assignment, milestone/approval breakdown (including overdue
// ones), budget vs. what's actually been released, and open disputes —
// the "is this project actually healthy" angle, not the "what happened
// recently" one. Same split as every other summarize_* skill: the facts
// are always computed from the platform's own data, only the opening
// line is handed to the LLM to phrase in plain language.
export const summarizeProjectSkill: AiSkill = {
  key: 'summarize_project',
  label: 'Summarize this project',
  requiredPermission: 'project:read',
  moduleContextPrefix: 'project',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma, llm }) {
    const projectId = moduleContext.split(':')[1];
    const project = await prisma.project.findFirst({
      where: { id: projectId, accountId: ctx.accountId },
    });
    if (!project) throw new NotFoundException('Project not found');

    const [assignments, milestones, quotes, payouts, openDisputes] = await Promise.all([
      prisma.projectVendorAssignment.findMany({
        where: { projectId },
        include: { vendor: { select: { businessName: true } } },
      }),
      prisma.projectMilestone.findMany({ where: { projectId } }),
      prisma.vendorQuote.findMany({ where: { projectId } }),
      prisma.payout.findMany({ where: { projectId, status: { not: 'failed' } } }),
      prisma.dispute.findMany({ where: { projectId, status: { in: ['open', 'under_review'] } } }),
    ]);

    const now = new Date();
    const completedMilestones = milestones.filter((m: { status: string }) => m.status === 'completed');
    const pendingApproval = milestones.filter((m: { approvalStatus: string }) => m.approvalStatus === 'requested');
    const overdueMilestones = milestones.filter(
      (m: { dueDate: Date | null; status: string }) => m.dueDate && m.dueDate < now && m.status !== 'completed',
    );
    const primaryVendor = assignments.find((a: { role: string }) => a.role === 'primary_contractor') ?? assignments[0];
    const acceptedQuote = quotes.find((q: { status: string }) => q.status === 'accepted');
    const totalReleased = payouts.reduce((sum: number, p: { amount: unknown }) => sum + Number(p.amount), 0);
    const budget = project.budget != null ? Number(project.budget) : null;
    const releasedPct = budget && budget > 0 ? Math.round((totalReleased / budget) * 100) : null;

    const items: string[] = [];
    items.push(
      primaryVendor
        ? `Vendor: ${(primaryVendor as { vendor: { businessName: string } }).vendor.businessName}`
        : 'No vendor assigned yet' + (quotes.length ? ` — ${quotes.length} quote(s) received` : ''),
    );
    items.push(
      milestones.length
        ? `Milestones: ${completedMilestones.length}/${milestones.length} completed` +
            (pendingApproval.length ? `, ${pendingApproval.length} awaiting approval` : '') +
            (overdueMilestones.length ? `, ${overdueMilestones.length} overdue` : '')
        : 'No milestones set yet',
    );
    items.push(
      budget != null
        ? `Budget: ${budget.toLocaleString()} ${project.currency} — ${totalReleased.toLocaleString()} ${project.currency} released so far (${releasedPct}%)`
        : `No budget set — ${totalReleased.toLocaleString()} ${project.currency} released so far`,
    );
    if (openDisputes.length > 0) {
      items.push(`${openDisputes.length} open dispute(s) on this project`);
    }

    const intro = await llm.complete({
      systemPrompt:
        'You summarize a renovation/construction project\'s overall health for its owner in one plain, factual sentence — call out anything that needs attention (overdue milestones, open disputes) rather than only good news.',
      userPrompt: `Project "${project.title}" (${project.projectType}), status ${project.status}. ${items.join('. ')}.`,
    });

    return {
      draftLabel: 'Project summary — draft',
      items: [intro, ...items],
      warn: overdueMilestones.length > 0 || openDisputes.length > 0,
    };
  },
};
