import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

const STALE_OPEN_WARNING_DAYS = 7;

// Module 12's AI Assistance action — open/in_progress/urgent counts and the
// age of the oldest unresolved request are computed deterministically from
// MaintenanceRequest, same split as summarize_lease_status and
// summarize_inspection_history: the LLM only phrases the opening line.
export const summarizeMaintenanceBacklogSkill: AiSkill = {
  key: 'summarize_maintenance_backlog',
  label: 'Summarize maintenance backlog',
  requiredPermission: 'maintenance:read',
  moduleContextPrefix: 'property',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma, llm }) {
    const propertyId = moduleContext.split(':')[1];
    const property = await prisma.property.findFirst({
      where: { id: propertyId, accountId: ctx.accountId },
    });
    if (!property) throw new NotFoundException('Property not found');

    const requests = await prisma.maintenanceRequest.findMany({
      where: { propertyId },
      orderBy: { createdAt: 'asc' },
    });

    type Req = { status: string; priority: string; title: string; createdAt: Date };
    const open = (requests as Req[]).filter((r) => r.status === 'open' || r.status === 'in_progress');
    const urgent = open.filter((r) => r.priority === 'urgent');
    const now = Date.now();
    const oldestOpen = open[0];
    const oldestOpenDays = oldestOpen
      ? Math.floor((now - oldestOpen.createdAt.getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    const stale = open.filter((r) => (now - r.createdAt.getTime()) / (1000 * 60 * 60 * 24) >= STALE_OPEN_WARNING_DAYS);

    const items: string[] = [];

    if (requests.length === 0) {
      const intro = await llm.complete({
        systemPrompt:
          'You tell a property owner in one short, plain sentence that no maintenance requests have been recorded for this property yet.',
        userPrompt: `Property "${property.name}" has zero maintenance requests on file.`,
      });
      return { draftLabel: 'Maintenance backlog — draft', items: [intro], warn: false };
    }

    const intro = await llm.complete({
      systemPrompt:
        'You summarize a property\'s maintenance backlog for its owner in one plain, factual sentence — mention if anything is urgent or has sat open a while. No hedging, no jargon.',
      userPrompt: `Property "${property.name}": ${open.length} open/in-progress request(s) of ${requests.length} total, ${urgent.length} marked urgent, oldest open request is ${oldestOpenDays} day(s) old.`,
    });
    items.push(intro);

    for (const request of open) {
      const ageDays = Math.floor((now - request.createdAt.getTime()) / (1000 * 60 * 60 * 24));
      items.push(`${request.title} — ${request.priority}, ${request.status.replace('_', ' ')}, ${ageDays} day(s) old`);
    }
    if (stale.length > 0) {
      items.push(`${stale.length} request(s) open ${STALE_OPEN_WARNING_DAYS}+ days — worth following up.`);
    }

    return {
      draftLabel: 'Maintenance backlog — draft',
      items,
      warn: urgent.length > 0 || stale.length > 0,
    };
  },
};
