import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

// The rest of Module 15's valuation gap — a real (if simple) automated
// estimate alongside the manual/AI-narrated history `PropertyValuation`
// already gives, and `model_roi_scenario`'s own rent/hold-sell modeling.
// "Comparable" means the same city and propertyType among other
// accounts' own active sale listings — a real market signal already
// sitting in PropertyListing, not a new integration.
//
// Deliberately re-implements the same comparable-search/currency-
// grouping logic PropertiesService.getComparableValuation uses, rather
// than calling that service — AiSkillDeps only ever hands a skill
// `prisma` and `llm` (see ai-skill.interface.ts), never other Nest
// services, the same "kept in sync, not shared" split
// model_roi_scenario's own comment already establishes between itself
// and PropertiesService.getRoiSummary.
export const estimateComparableValueSkill: AiSkill = {
  key: 'estimate_comparable_value',
  label: 'Estimate value from comparable listings',
  requiredPermission: 'property:read',
  moduleContextPrefix: 'property',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma, llm }) {
    const propertyId = moduleContext.split(':')[1];
    const property = await prisma.property.findFirst({
      where: { id: propertyId, accountId: ctx.accountId },
    });
    if (!property) throw new NotFoundException('Property not found');

    const comparableListings = await prisma.propertyListing.findMany({
      where: {
        status: 'active',
        listingType: 'sale',
        propertyId: { not: propertyId },
        property: { city: property.city, propertyType: property.propertyType },
      },
      select: { askingPrice: true, currency: true },
    });

    const MIN_COMPARABLES = 2;
    const byCurrency = new Map<string, { total: number; count: number }>();
    for (const listing of comparableListings as { askingPrice: unknown; currency: string }[]) {
      const price = Number(listing.askingPrice);
      const group = byCurrency.get(listing.currency) ?? { total: 0, count: 0 };
      group.total += price;
      group.count += 1;
      byCurrency.set(listing.currency, group);
    }
    // Same "grouped by currency, never blended across them" caution the
    // service version already applies — pick the currency group with the
    // most comparables to narrate, rather than averaging across markets
    // that use different money.
    const best = Array.from(byCurrency, ([currency, g]) => ({ currency, ...g })).sort((a, b) => b.count - a.count)[0];

    const items: string[] = [];
    let warn = false;

    if (!best || best.count < MIN_COMPARABLES) {
      items.push(
        `Not enough comparable active sale listings in ${property.city ?? 'this area'} (${property.propertyType.replace(/_/g, ' ')}) to estimate a value — found ${best?.count ?? 0}, need at least ${MIN_COMPARABLES}.`,
      );
      warn = true;
    } else {
      const estimate = Math.round(best.total / best.count);
      const intro = await llm.complete({
        systemPrompt:
          'You explain a comparable-sales value estimate to a property owner in one short, plain-language sentence. Be clear this is a rough market estimate, not an appraisal.',
        userPrompt: `Property "${property.name}" in ${property.city}. Estimated value ${estimate.toLocaleString()} ${best.currency}, based on ${best.count} comparable active sale listing(s) of the same property type nearby.`,
      });
      items.push(intro);
      items.push(`Estimated value: ~${estimate.toLocaleString()} ${best.currency} (based on ${best.count} comparable listing(s))`);
      items.push('This is a rough market estimate from currently listed comparable properties, not a professional appraisal.');
    }

    return { draftLabel: 'Comparable-sales estimate — draft', items, warn };
  },
};
