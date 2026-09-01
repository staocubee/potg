import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

// The "summarize" and "report" actions from Module 2's AI Assistance
// section. The facts (document count, missing docs, timeline event count)
// are always computed deterministically from the platform's own data —
// only the opening line is handed to the LLM provider to phrase in plain
// language, so a stubbed provider still returns a fully useful, factually
// correct draft.
export const summarizePropertySkill: AiSkill = {
  key: 'summarize_property',
  label: 'Summarize this property',
  requiredPermission: 'property:read',
  moduleContextPrefix: 'property',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma, llm }) {
    const propertyId = moduleContext.split(':')[1];
    const property = await prisma.property.findFirst({
      where: { id: propertyId, accountId: ctx.accountId },
    });
    if (!property) throw new NotFoundException('Property not found');

    const [documents, timelineEvents] = await Promise.all([
      prisma.document.findMany({ where: { propertyId } }),
      prisma.propertyTimelineEvent.findMany({ where: { propertyId } }),
    ]);
    const missingCount = documents.filter(
      (d: { verificationStatus: string }) => d.verificationStatus !== 'verified',
    ).length;

    const intro = await llm.complete({
      systemPrompt:
        'You summarize a single property record for its owner in one plain, reassuring sentence. No hedging, no jargon.',
      userPrompt: `Property "${property.name}" (${property.propertyType}) in ${property.city ?? property.country}, ${documents.length} documents on file, ${missingCount} not yet verified, ${timelineEvents.length} timeline events.`,
    });

    return {
      draftLabel: 'Property summary — draft',
      items: [
        intro,
        `${property.propertyType.replace(/_/g, ' ')} in ${property.city ?? property.country}`,
        `${documents.length} document(s) on file, ${missingCount} not yet verified`,
        `${timelineEvents.length} event(s) on the property timeline`,
      ],
      warn: false,
    };
  },
};
