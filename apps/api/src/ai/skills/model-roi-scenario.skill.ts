import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { AiSkillInputSchema } from './ai-skill-input-schema';

// The one skill in this registry that actually reads `input` today — see
// the big comment on ai-skill-input-schema.ts for why that made it the
// obvious place to prove out a real (non-empty) schema. Nothing here is
// `required`: `scenario` itself defaults to "current", and each scenario's
// own fields default sensibly inside run() below, so a bare `{}` (what
// every quick-action button sent before this pass, and what the stub LLM
// provider still sends) keeps working exactly as it did.
const MODEL_ROI_SCENARIO_INPUT_SCHEMA: AiSkillInputSchema = {
  type: 'object',
  properties: {
    scenario: {
      type: 'string',
      description: 'Which scenario to model.',
      enum: ['current', 'rent_increase', 'sell_now_vs_hold'],
      default: 'current',
    },
    currentMonthlyRent: {
      type: 'number',
      description:
        'Current monthly rent, in the property\'s own currency. Used by the "rent_increase" scenario; ignored otherwise.',
      minimum: 0,
    },
    rentIncreasePercent: {
      type: 'number',
      description: 'Percentage rent increase to model, e.g. 10 for 10%. Used by the "rent_increase" scenario.',
      minimum: 0,
      maximum: 500,
    },
    holdYears: {
      type: 'number',
      description: 'Years to hold before selling. Used by the "sell_now_vs_hold" scenario. Defaults to 2.',
      minimum: 0,
      maximum: 50,
      default: 2,
    },
    appreciationRatePercent: {
      type: 'number',
      description:
        'Assumed annual appreciation rate, as a percentage. Used by the "sell_now_vs_hold" scenario. Defaults to 5.',
      minimum: -50,
      maximum: 100,
      default: 5,
    },
  },
};

// Module 15's "do financials" surface — the primary reason Priority 6
// exists. Every number here is a deliberately simple, undiscounted
// estimate (no financing costs, no selling costs, no tax) — Section 5.4's
// guardrail note ("AI-generated valuations... are labeled as assistive
// estimates, not professional advice") is enforced by always appending the
// disclaimer line, not just by a UI label somewhere else.
//
// input.scenario: "current" | "rent_increase" | "sell_now_vs_hold"
// input.currentMonthlyRent, input.rentIncreasePercent — for "rent_increase"
// input.holdYears, input.appreciationRatePercent — for "sell_now_vs_hold"
export const modelRoiScenarioSkill: AiSkill = {
  key: 'model_roi_scenario',
  label: 'Model an ROI or rent scenario',
  requiredPermission: 'property:read',
  moduleContextPrefix: 'property',
  inputSchema: MODEL_ROI_SCENARIO_INPUT_SCHEMA,

  async run(ctx, moduleContext, input, { prisma, llm }) {
    const propertyId = moduleContext.split(':')[1];
    const property = await prisma.property.findFirst({
      where: { id: propertyId, accountId: ctx.accountId },
      include: { account: { select: { currency: true } } },
    });
    if (!property) throw new NotFoundException('Property not found');

    const latestValuation = await prisma.propertyValuation.findFirst({
      where: { propertyId },
      orderBy: { valuedAt: 'desc' },
    });
    const currentValue = latestValuation
      ? Number(latestValuation.estimatedValue)
      : Number(property.estimatedValue ?? 0);
    const currency = latestValuation?.currency ?? property.account.currency;

    // "What's actually been put into this property" — the original
    // estimated value (a stand-in for acquisition cost — this scaffold has
    // no separate purchase-price field) plus everything released from
    // escrow on its projects so far.
    const projects = await prisma.project.findMany({ where: { propertyId }, select: { id: true } });
    const projectIds = projects.map((p: { id: string }) => p.id);
    const payouts = projectIds.length
      ? await prisma.payout.findMany({ where: { projectId: { in: projectIds }, status: { not: 'failed' } } })
      : [];
    const totalSpentOnProjects = payouts.reduce((sum: number, p: { amount: unknown }) => sum + Number(p.amount), 0);
    const invested = Number(property.estimatedValue ?? currentValue) + totalSpentOnProjects;

    const items: string[] = [];
    const scenario = (input.scenario as string) ?? 'current';

    if (scenario === 'rent_increase') {
      const currentRent = Number(input.currentMonthlyRent ?? 0);
      const increasePct = Number(input.rentIncreasePercent ?? 0);
      const newRent = currentRent * (1 + increasePct / 100);
      const currentYield = currentValue > 0 ? ((currentRent * 12) / currentValue) * 100 : 0;
      const newYield = currentValue > 0 ? ((newRent * 12) / currentValue) * 100 : 0;
      items.push(`Current rent: ${currentRent.toLocaleString()} ${currency}/month → gross yield ~${currentYield.toFixed(1)}%/year`);
      items.push(
        `At +${increasePct}%: ${newRent.toLocaleString()} ${currency}/month → gross yield ~${newYield.toFixed(1)}%/year`,
      );
    } else if (scenario === 'sell_now_vs_hold') {
      const holdYears = Number(input.holdYears ?? 2);
      const appreciationPct = Number(input.appreciationRatePercent ?? 5);
      const futureValue = currentValue * Math.pow(1 + appreciationPct / 100, holdYears);
      const netNow = currentValue - invested;
      const netLater = futureValue - invested;
      items.push(`Sell now: estimated net position ~${netNow.toLocaleString()} ${currency}`);
      items.push(
        `Hold ${holdYears} year(s) at ${appreciationPct}%/year appreciation: projected value ~${futureValue.toLocaleString()} ${currency}, net position ~${netLater.toLocaleString()} ${currency}`,
      );
    } else {
      const roi = invested > 0 ? ((currentValue - invested) / invested) * 100 : 0;
      items.push(`Current estimated value: ${currentValue.toLocaleString()} ${currency}`);
      items.push(`Total invested (acquisition + project spend): ${invested.toLocaleString()} ${currency}`);
      items.push(`Simple ROI: ${roi.toFixed(1)}%`);
    }

    const intro = await llm.complete({
      systemPrompt:
        'You explain a simplified property financial scenario to its owner in one short, plain-language paragraph. Be clear these are rough estimates, not financial advice.',
      userPrompt: `Property "${property.name}". Scenario: ${scenario}. Numbers: ${items.join('; ')}.`,
    });

    items.unshift(intro);
    items.push('This is a simplified, undiscounted estimate (no financing, selling, or tax costs) — not professional financial or valuation advice.');

    return { draftLabel: 'Financial scenario — draft', items, warn: false };
  },
};
