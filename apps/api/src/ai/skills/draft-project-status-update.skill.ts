import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

// Module 9's "AI drafts a plain-language progress update from stage/
// milestone state" action — the wireframe's RenovationProject "Draft status
// update" quick action. Same split as summarize_property: the facts (stage
// completion, recent raw updates) are always computed from the platform's
// own data; the LLM only phrases them into one paragraph, so a stubbed
// provider still returns something factually correct and postable.
export const draftProjectStatusUpdateSkill: AiSkill = {
  key: 'draft_project_status_update',
  label: 'Draft a status update',
  requiredPermission: 'project:read',
  moduleContextPrefix: 'project',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma, llm }) {
    const projectId = moduleContext.split(':')[1];
    const project = await prisma.project.findFirst({
      where: { id: projectId, accountId: ctx.accountId },
    });
    if (!project) throw new NotFoundException('Project not found');

    const [stages, recentUpdates] = await Promise.all([
      prisma.projectStage.findMany({ where: { projectId }, orderBy: { sortOrder: 'asc' } }),
      prisma.projectUpdate.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        take: 3,
      }),
    ]);

    const completed = stages.filter((s: { status: string }) => s.status === 'completed');
    const current = stages.find((s: { status: string }) => s.status === 'in_progress');
    const recentText = recentUpdates.length
      ? recentUpdates.map((u: { description: string }) => `- ${u.description}`).join('\n')
      : '(no progress updates logged yet)';

    const draft = await llm.complete({
      systemPrompt:
        'You write a short, plain-language project status update for a property owner. One short paragraph, reassuring but factual, no hedging or jargon. Do not invent facts beyond what is given.',
      userPrompt: `Project "${project.title}" (${project.projectType}), status ${project.status}. Stages: ${stages
        .map((s: { name: string; status: string }) => `${s.name}=${s.status}`)
        .join(', ')}. Currently on: ${current?.name ?? 'none'}. Recent updates:\n${recentText}`,
    });

    return {
      draftLabel: 'Status update — draft',
      items: [
        draft,
        `Stages completed: ${completed.length}/${stages.length}`,
        `Currently on: ${current?.name ?? 'none'}`,
      ],
      warn: false,
    };
  },
};
