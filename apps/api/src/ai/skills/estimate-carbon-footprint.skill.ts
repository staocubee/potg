import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

// A rough, self-evidently-labeled estimate — the only version of "Carbon
// estimate" (Module 22) buildable without a real smart-meter/energy-
// provider integration, which this pass deliberately doesn't fake (see
// PropertyDevice's own comment). Uses a flat, published-average kg-CO2e-
// per-square-metre-per-year figure for residential electricity use,
// scaled by the property's own squareFootage (Module 3) — a genuine,
// if approximate, computation from real data already on the record, not
// a fabricated device reading.
const AVG_KG_CO2E_PER_SQM_PER_YEAR = 30;

export const estimateCarbonFootprintSkill: AiSkill = {
  key: 'estimate_carbon_footprint',
  label: 'Estimate this property’s carbon footprint',
  requiredPermission: 'property:read',
  moduleContextPrefix: 'property',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma, llm }) {
    const propertyId = moduleContext.split(':')[1];
    const property = await prisma.property.findFirst({
      where: { id: propertyId, accountId: ctx.accountId },
    });
    if (!property) throw new NotFoundException('Property not found');

    if (!property.squareFootage) {
      return {
        draftLabel: 'Carbon estimate — draft',
        items: [
          'This property has no square footage on record yet, so a carbon estimate cannot be computed. Add it under Property Details first.',
        ],
        warn: true,
      };
    }

    const squareMetres = property.squareFootage * 0.092903;
    const estimatedKgPerYear = Math.round(squareMetres * AVG_KG_CO2E_PER_SQM_PER_YEAR);

    const intro = await llm.complete({
      systemPrompt:
        'You explain a rough carbon-footprint estimate for a residential property to its owner in one plain sentence. Be clear this is a rough estimate from average figures, not a measurement from real energy data.',
      userPrompt: `Property "${property.name}" (${property.propertyType}), ${property.squareFootage} sq ft, estimated ${estimatedKgPerYear} kg CO2e/year based on average residential energy use per square metre.`,
    });

    return {
      draftLabel: 'Carbon estimate — draft',
      items: [
        intro,
        `Estimated ${estimatedKgPerYear.toLocaleString()} kg CO2e/year`,
        'Based on a published average for residential electricity use per square metre — not a measurement from this property’s actual meter, since no smart-meter integration is connected yet.',
      ],
      warn: false,
    };
  },
};
