import { PrismaService } from '../prisma/prisma.service';

// The flag list assess_project_risk (the AI skill) and
// ReportsService.getAtRiskOverview (the cross-portfolio dashboard view)
// both need word-for-word identical — same reasoning
// vendors/trust-score.ts's own getVendorRiskFlags already documents: these
// two callers show the exact same flags for the same project side by
// side, so drift between them would be a visible inconsistency, not just
// a maintenance annoyance.
export async function getProjectRiskFlags(
  prisma: PrismaService,
  project: { id: string; budget: unknown; currency: string; status: string },
): Promise<string[]> {
  const [assignments, milestones, payouts, openDisputes] = await Promise.all([
    prisma.projectVendorAssignment.findMany({ where: { projectId: project.id } }),
    prisma.projectMilestone.findMany({ where: { projectId: project.id } }),
    prisma.payout.findMany({ where: { projectId: project.id, status: { not: 'failed' } } }),
    prisma.dispute.findMany({ where: { projectId: project.id, status: { in: ['open', 'under_review'] } } }),
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

  // grossAmount — comparing against the project's own budget means "how
  // much has actually been released against it," unaffected by the
  // platform's own fee cut (see src/payments/platform-fee.ts), which
  // only reduces the vendor's own net take-home.
  const totalReleased = payouts.reduce((sum: number, p: { grossAmount: unknown }) => sum + Number(p.grossAmount), 0);
  const budget = project.budget != null ? Number(project.budget) : null;
  if (budget != null && budget > 0 && totalReleased > budget) {
    flags.push(
      `Released so far (${totalReleased.toLocaleString()} ${project.currency}) exceeds the project's own budget (${budget.toLocaleString()} ${project.currency})`,
    );
  }

  if (project.status === 'in_progress' && assignments.length === 0) {
    flags.push('Marked in progress but no vendor is assigned');
  }

  return flags;
}
