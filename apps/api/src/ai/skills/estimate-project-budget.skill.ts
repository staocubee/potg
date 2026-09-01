import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';
import { matchScopeItems } from './cost-estimates';

// Module 9's "generate a rough Bill of Quantities / budget estimate from
// the scope description" action, and the wireframe's RenovationProject
// "Estimate budget" quick action. Entirely deterministic — a keyword match
// against a placeholder cost table (cost-estimates.ts) — so it needs no LLM
// call and gives the same answer for the same scope every time, which is
// what you want from a number someone will set a budget against.
export const estimateProjectBudgetSkill: AiSkill = {
  key: 'estimate_project_budget',
  label: 'Estimate project budget',
  requiredPermission: 'project:read',
  moduleContextPrefix: 'project',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma }) {
    const projectId = moduleContext.split(':')[1];
    const project = await prisma.project.findFirst({
      where: { id: projectId, accountId: ctx.accountId },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.scopeDescription) {
      throw new BadRequestException('This project has no scope description to estimate from yet');
    }

    const matched = matchScopeItems(project.scopeDescription);
    const total = matched.reduce((sum, item) => sum + item.unitCost, 0);

    if (matched.length === 0) {
      return {
        draftLabel: 'Budget estimate — draft',
        items: [
          "Couldn't match any recognized scope items in the description — this is a placeholder cost table, not a real pricing catalog.",
        ],
        warn: true,
      };
    }

    const items = matched.map(
      (item) => `${item.label} — ~${item.unitCost.toLocaleString()} ${project.currency}`,
    );
    items.push(`Estimated total — ~${total.toLocaleString()} ${project.currency} (${matched.length} item(s) matched)`);

    const overBudget = project.budget != null && total > Number(project.budget);
    if (overBudget) {
      items.push(
        `This exceeds the project's stated budget of ${Number(project.budget).toLocaleString()} ${project.currency}`,
      );
    }

    return {
      draftLabel: 'Budget estimate — draft',
      items,
      warn: overBudget,
    };
  },
};
