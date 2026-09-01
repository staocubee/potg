import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

// Module 11's "plain-language fee/milestone explanation" — the wireframe's
// PaymentsEscrow artboard. Same split as summarize_property: every number
// here is computed from the real ledger (deposits, releases, current
// balance); only the platform fee is illustrative, since this scaffold
// doesn't actually deduct one anywhere yet (see the schema comment on
// Payment) — the skill says so rather than implying a fee was charged.
const PLATFORM_FEE_RATE = 0.025;

export const explainFeesSkill: AiSkill = {
  key: 'explain_fees',
  label: 'Explain fees & escrow activity',
  requiredPermission: 'payment:read',
  moduleContextPrefix: 'project',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma, llm }) {
    const projectId = moduleContext.split(':')[1];
    const project = await prisma.project.findFirst({
      where: { id: projectId, accountId: ctx.accountId },
    });
    if (!project) throw new NotFoundException('Project not found');

    const [escrowAccount, payments, payouts] = await Promise.all([
      prisma.escrowAccount.findUnique({ where: { projectId } }),
      prisma.payment.findMany({ where: { projectId, status: 'completed' } }),
      prisma.payout.findMany({ where: { projectId, status: { not: 'failed' } } }),
    ]);

    const totalDeposited = payments.reduce((sum: number, p: { amount: unknown }) => sum + Number(p.amount), 0);
    const totalReleased = payouts.reduce((sum: number, p: { amount: unknown }) => sum + Number(p.amount), 0);
    const balance = escrowAccount ? Number(escrowAccount.balance) : 0;
    const currency = escrowAccount?.currency ?? project.currency;
    const illustrativeFee = totalReleased * PLATFORM_FEE_RATE;

    const intro = await llm.complete({
      systemPrompt:
        'You explain a project escrow account to its owner in one short, plain-language paragraph. No jargon, no hedging, be concrete about the numbers given.',
      userPrompt: `Project "${project.title}". Deposited: ${totalDeposited} ${currency} across ${payments.length} payment(s). Released to the vendor: ${totalReleased} ${currency} across ${payouts.length} payout(s). Current escrow balance: ${balance} ${currency}.`,
    });

    return {
      draftLabel: 'Escrow & fees — draft',
      items: [
        intro,
        `Deposited: ${totalDeposited.toLocaleString()} ${currency} (${payments.length} payment(s))`,
        `Released to vendor: ${totalReleased.toLocaleString()} ${currency} (${payouts.length} payout(s))`,
        `Current escrow balance: ${balance.toLocaleString()} ${currency}`,
        `Illustrative platform fee at ${(PLATFORM_FEE_RATE * 100).toFixed(1)}%: ~${illustrativeFee.toLocaleString()} ${currency} — not actually deducted anywhere yet in this scaffold`,
      ],
      warn: false,
    };
  },
};
