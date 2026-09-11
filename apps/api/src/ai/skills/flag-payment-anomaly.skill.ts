import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

// Module 11's anomaly-flagging skill — the wireframe's PaymentsEscrow
// "Flag anomalies" quick action. Entirely invariant checks against the
// platform's own ledger (no real fraud-signal data exists in a scaffold
// with no live payment gateway): a payout that doesn't match the milestone
// it was released for, more than one live payout against the same
// milestone, a single payout that dwarfs the project's stated budget, and
// a negative escrow balance, which should be structurally impossible given
// releaseMilestone's own balance check but is worth surfacing if it's ever
// seen, since it would mean the ledger and the account balance disagree.
const LARGE_PAYOUT_BUDGET_FRACTION = 0.6;

export const flagPaymentAnomalySkill: AiSkill = {
  key: 'flag_payment_anomaly',
  label: 'Flag payment anomalies',
  requiredPermission: 'payment:read',
  moduleContextPrefix: 'project',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma }) {
    const projectId = moduleContext.split(':')[1];
    const project = await prisma.project.findFirst({
      where: { id: projectId, accountId: ctx.accountId },
    });
    if (!project) throw new NotFoundException('Project not found');

    const [escrowAccount, payouts] = await Promise.all([
      prisma.escrowAccount.findUnique({ where: { projectId } }),
      prisma.payout.findMany({ where: { projectId, status: { not: 'failed' } }, include: { milestone: true } }),
    ]);

    const items: string[] = [];
    let warn = false;

    if (escrowAccount && Number(escrowAccount.balance) < 0) {
      items.push(`Escrow balance is negative (${escrowAccount.balance}) — this should never happen, investigate.`);
      warn = true;
    }

    type PayoutWithMilestone = {
      id: string;
      amount: unknown;
      grossAmount: unknown;
      currency: string;
      milestoneId: string | null;
      milestone: { title: string; paymentAmount: unknown } | null;
    };
    const byMilestone = new Map<string, PayoutWithMilestone[]>();
    for (const payout of payouts as PayoutWithMilestone[]) {
      if (!payout.milestoneId) continue;
      const list = byMilestone.get(payout.milestoneId) ?? [];
      list.push(payout);
      byMilestone.set(payout.milestoneId, list);
    }
    for (const [, list] of byMilestone) {
      if (list.length > 1) {
        items.push(
          `Milestone "${list[0].milestone?.title ?? list[0].milestoneId}" has ${list.length} live payouts — expected at most one.`,
        );
        warn = true;
      }
      for (const payout of list) {
        // Compared against grossAmount, not amount — amount is
        // deliberately net of the platform's own fee cut now (see
        // src/payments/platform-fee.ts), so it legitimately differs from
        // the milestone's own paymentAmount on every real payout; the
        // real invariant worth checking is that grossAmount (what
        // actually left escrow) still matches the milestone exactly.
        const expected = payout.milestone?.paymentAmount != null ? Number(payout.milestone.paymentAmount) : null;
        if (expected != null && Math.abs(expected - Number(payout.grossAmount)) > 0.01) {
          items.push(
            `Payout of ${payout.grossAmount} on "${payout.milestone?.title}" doesn't match its milestone's payment amount (${expected}).`,
          );
          warn = true;
        }
      }
    }

    if (project.budget != null) {
      const budget = Number(project.budget);
      for (const payout of payouts as PayoutWithMilestone[]) {
        if (Number(payout.grossAmount) > budget * LARGE_PAYOUT_BUDGET_FRACTION) {
          items.push(
            `A single payout of ${payout.grossAmount} ${payout.currency} is more than ${LARGE_PAYOUT_BUDGET_FRACTION * 100}% of the project's stated budget (${budget}) — worth a second look.`,
          );
          warn = true;
        }
      }
    }

    if (items.length === 0) {
      items.push("No anomalies found in this project's payout history.");
    }

    return {
      draftLabel: 'Payment anomaly check — draft',
      items,
      warn,
    };
  },
};
