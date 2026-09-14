import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { AiSkillInputSchema } from './ai-skill-input-schema';

const GENERATE_PROJECT_SCOPE_INPUT_SCHEMA: AiSkillInputSchema = {
  type: 'object',
  properties: {
    projectType: {
      type: 'string',
      description: 'The kind of project this scope is for.',
      enum: ['renovation', 'new_build', 'maintenance', 'landscaping', 'interior_design'],
      default: 'renovation',
    },
    goals: {
      type: 'string',
      description:
        'What the owner wants done, in their own words (e.g. "modernize kitchen and bathroom, keep the layout"). Optional — the draft still grounds itself in the property\'s own real facts without it, just more generically.',
    },
  },
};

// The audit's own finding on Workflow 3: "Defines scope, or AI generates
// it — AI-generated scope doesn't exist — the AI skills that touch scope
// only read an existing one to estimate budget or draft a materials
// list; none writes it." Deliberately keyed on the property, not a
// project — at the point a scope is actually needed (filling out the
// "New Project" form) no Project row exists yet to key a moduleContext
// on, unlike every other draft skill in this registry. No chained write
// on Accept, unlike generate_listing_description/draft_project_status_
// update: the scope textarea on that same form is already the real
// destination, and the human still has to submit the form themselves —
// the strongest possible human-in-the-loop, not a weaker one.
export const generateProjectScopeSkill: AiSkill = {
  key: 'generate_project_scope',
  label: 'Generate a project scope',
  requiredPermission: 'project:write',
  moduleContextPrefix: 'property',
  inputSchema: GENERATE_PROJECT_SCOPE_INPUT_SCHEMA,

  async run(ctx, moduleContext, input, { prisma, llm }) {
    const propertyId = moduleContext.split(':')[1];
    const property = await prisma.property.findFirst({
      where: { id: propertyId, accountId: ctx.accountId },
    });
    if (!property) throw new NotFoundException('Property not found');

    const projectType = ((input.projectType as string) || 'renovation').replace(/_/g, ' ');
    const goals = (input.goals as string) ?? '';
    const location = [property.city, property.country].filter(Boolean).join(', ');

    const draft = await llm.complete({
      systemPrompt:
        'You write a clear, realistic project scope description (2-4 sentences) for a construction/renovation project, from the facts given. Concrete and actionable, no invented details beyond what is provided, no hedging.',
      userPrompt: `A ${projectType} project on a ${property.propertyType.replace(/_/g, ' ')} in ${location}.${
        goals ? ` Owner's own goals, in their words: "${goals}".` : ' No specific goals given yet — draft a generic but concrete starting point for this project type.'
      }`,
    });

    return {
      draftLabel: 'Project scope — draft',
      items: [draft, `${projectType} — ${property.propertyType.replace(/_/g, ' ')} in ${location}`],
      warn: !goals,
    };
  },
};
