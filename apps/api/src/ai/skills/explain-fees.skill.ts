import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

// Module 11's "plain-language fee/milestone explanation" — the wireframe's
// PaymentsEscrow artboard. Every number here is computed from the real
// ledger (deposits, releases, current balance) and, now, the real
// platform fee actually deducted from each payout — this used to show a
// hardcoded 2.5% "illustrative... not actually deducted anywhere yet"
// placeholder; PaymentsService.releaseMilestone now really deducts one
// (see src/payments/platform-fee.ts). Sums each payout's own real,
// already-persisted platformFeeAmount rather than recomputing from the
// current fee rate — accurate even if that rate changes over time,
// matching AiSkillDeps' own "duplicate a small computation, don't share
// a REST service" convention (nothing here is a 10-20-line calculation
// worth importing platform-fee.ts's own ConfigService-shaped helper
// for — the real total is just sitting on the rows already).

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
    // Gross (released from escrow) vs. net (what the vendor actually
    // received) vs. the real platform fee that made up the difference —
    // see src/payments/platform-fee.ts. Pre-fee historical payouts have
    // platformFeeAmount = 0, so this reads correctly for them too (gross
    // and net are simply equal).
    const totalReleasedGross = payouts.reduce((sum: number, p: { grossAmount: unknown }) => sum + Number(p.grossAmount), 0);
    const totalReleasedNet = payouts.reduce((sum: number, p: { amount: unknown }) => sum + Number(p.amount), 0);
    const totalPlatformFee = payouts.reduce((sum: number, p: { platformFeeAmount: unknown }) => sum + Number(p.platformFeeAmount), 0);
    const balance = escrowAccount ? Number(escrowAccount.balance) : 0;
    const currency = escrowAccount?.currency ?? project.currency;

    const intro = await llm.complete({
      systemPrompt:
        'You explain a project escrow account to its owner in one short, plain-language paragraph. No jargon, no hedging, be concrete about the numbers given.',
      userPrompt: `Project "${project.title}". Deposited: ${totalDeposited} ${currency} across ${payments.length} payment(s). Released from escrow: ${totalReleasedGross} ${currency} across ${payouts.length} payout(s), of which the vendor received ${totalReleasedNet} ${currency} net of a ${totalPlatformFee} ${currency} platform fee. Current escrow balance: ${balance} ${currency}.`,
    });

    return {
      draftLabel: 'Escrow & fees — draft',
      items: [
        intro,
        `Deposited: ${totalDeposited.toLocaleString()} ${currency} (${payments.length} payment(s))`,
        `Released from escrow: ${totalReleasedGross.toLocaleString()} ${currency} (${payouts.length} payout(s))`,
        `Received by the vendor, net of the platform fee: ${totalReleasedNet.toLocaleString()} ${currency}`,
        `Platform fee retained: ${totalPlatformFee.toLocaleString()} ${currency}`,
        `Current escrow balance: ${balance.toLocaleString()} ${currency}`,
      ],
      warn: false,
    };
  },
};
