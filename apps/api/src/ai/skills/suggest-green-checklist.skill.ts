import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

// Module 22's "Green building checklist" — same shape as
// suggest_document_checklist (Module 6): a fixed, generic default list
// (no jurisdiction-specific green-building code is wired up here) that
// the LLM phrases and lightly tailors to the property's own type and age
// (Module 3's yearBuilt), returned as a plain checklist to track
// manually — no new stateful "checked/unchecked" model, matching how
// every other *_checklist skill in this registry is read-only guidance,
// not a tracked entity.
const DEFAULT_GREEN_CHECKLIST = [
  'LED or energy-efficient lighting throughout',
  'Insulation in roof/ceiling and walls',
  'Water-efficient fixtures (low-flow taps, dual-flush toilets)',
  'Energy-efficient windows or window treatments',
  'Properly maintained HVAC/cooling system',
  'Solar water heating or solar panels, if feasible',
  'Rainwater harvesting or greywater reuse, if feasible',
  'Waste segregation and recycling arrangement',
];

export const suggestGreenChecklistSkill: AiSkill = {
  key: 'suggest_green_checklist',
  label: 'Suggest a green building checklist',
  requiredPermission: 'property:read',
  moduleContextPrefix: 'property',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma, llm }) {
    const propertyId = moduleContext.split(':')[1];
    const property = await prisma.property.findFirst({
      where: { id: propertyId, accountId: ctx.accountId },
    });
    if (!property) throw new NotFoundException('Property not found');

    const ageNote = property.yearBuilt
      ? `built in ${property.yearBuilt}`
      : 'of unknown build year';

    const intro = await llm.complete({
      systemPrompt:
        'You introduce a sustainability/green-building checklist for a property owner in one short, encouraging sentence. No hedging, no jargon.',
      userPrompt: `Property "${property.name}" (${property.propertyType}), ${ageNote}. Introduce a generic sustainability checklist for it.`,
    });

    return {
      draftLabel: 'Green building checklist — draft',
      items: [intro, ...DEFAULT_GREEN_CHECKLIST],
      warn: false,
    };
  },
};
