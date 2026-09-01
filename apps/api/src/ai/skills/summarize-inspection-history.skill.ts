import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

// Module 8's AI Assistance action — what a property's inspection history
// actually says about its condition, not just a list of past visits.
// Same split as summarize_property: every number here is computed
// deterministically from PropertyInspection/InspectionFinding, the LLM
// only phrases the opening line, so a stubbed provider still returns a
// fully useful, factually grounded draft.
export const summarizeInspectionHistorySkill: AiSkill = {
  key: 'summarize_inspection_history',
  label: 'Summarize inspection history',
  requiredPermission: 'inspection:read',
  moduleContextPrefix: 'property',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma, llm }) {
    const propertyId = moduleContext.split(':')[1];
    const property = await prisma.property.findFirst({
      where: { id: propertyId, accountId: ctx.accountId },
    });
    if (!property) throw new NotFoundException('Property not found');

    const inspections = await prisma.propertyInspection.findMany({
      where: { propertyId },
      include: { findings: true },
      orderBy: { scheduledFor: 'desc' },
    });

    type InspectionWithFindings = {
      status: string;
      overallResult: string | null;
      scheduledFor: Date;
      inspectionType: string;
      findings: { area: string; severity: string }[];
    };
    const completed = (inspections as InspectionWithFindings[]).filter((i) => i.status === 'completed');
    const upcoming = (inspections as InspectionWithFindings[]).filter((i) => i.status === 'scheduled');
    const needsAttentionOrFail = completed.filter((i) => i.overallResult !== 'pass');
    const majorFindings = completed.flatMap((i) => i.findings.filter((f) => f.severity === 'major'));
    const latest = completed[0];

    const items: string[] = [];

    if (inspections.length === 0) {
      items.push('No inspections have been recorded for this property yet.');
      const intro = await llm.complete({
        systemPrompt:
          'You tell a property owner in one short, plain sentence that no inspections have been logged yet, and that scheduling one would establish a baseline.',
        userPrompt: `Property "${property.name}" has zero inspections on file.`,
      });
      items.unshift(intro);
      return { draftLabel: 'Inspection history — draft', items, warn: false };
    }

    const intro = await llm.complete({
      systemPrompt:
        'You summarize a property\'s inspection history for its owner in one plain, factual sentence — call out whether the picture is generally good or whether something needs attention. No hedging, no jargon.',
      userPrompt: `Property "${property.name}": ${completed.length} completed inspection(s), ${needsAttentionOrFail.length} came back "needs_attention" or "fail", ${majorFindings.length} major finding(s) total, most recent result: ${latest?.overallResult ?? 'none yet'}.`,
    });
    items.push(intro);
    items.push(`${completed.length} completed inspection(s), ${upcoming.length} scheduled`);
    if (latest) {
      items.push(
        `Most recent: ${latest.inspectionType.replace(/_/g, ' ')} on ${latest.scheduledFor.toISOString().slice(0, 10)} — ${(latest.overallResult ?? 'unknown').replace(/_/g, ' ')}`,
      );
    }
    if (majorFindings.length > 0) {
      const areas = Array.from(new Set(majorFindings.map((f) => f.area))).join(', ');
      items.push(`Major findings on record in: ${areas}`);
    }

    return {
      draftLabel: 'Inspection history — draft',
      items,
      warn: needsAttentionOrFail.length > 0 || majorFindings.length > 0,
    };
  },
};
