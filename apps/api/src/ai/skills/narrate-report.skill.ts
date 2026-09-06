import { BadRequestException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { AiSkillInputSchema } from './ai-skill-input-schema';

// The rest of Module 23's "natural-language report generation on top of
// every report type" — generate_portfolio_report already covers the one
// fixed portfolio-overview report; this covers the report *builder*'s
// own custom, saved reports, which had no narration option at all.
const NARRATE_REPORT_INPUT_SCHEMA: AiSkillInputSchema = {
  type: 'object',
  properties: {
    reportDefinitionId: {
      type: 'string',
      description: 'The id of a saved report definition (see GET /reports/definitions) to narrate.',
    },
  },
  required: ['reportDefinitionId'],
};

// moduleContext is "account:<id>", same as generate_portfolio_report —
// a saved ReportDefinition is account-scoped, not tied to one property/
// project/listing. The second skill in this entire registry with a real
// (non-empty) inputSchema, after model_roi_scenario — reportDefinitionId
// is genuinely required (there's no sensible default "which report,"
// unlike model_roi_scenario's own scenario/fields), so this is the first
// skill AskAiPanel's generic per-field form actually has to collect a
// value for rather than the field being optional with a schema default.
//
// Calls ReportsService.runDefinition directly (via AiSkillDeps.reports —
// see that field's own comment for why this is the one skill that shares
// a service instead of duplicating its logic): the report builder's
// metric registry already turns a saved definition into the same
// {label, value} rows GET /reports/definitions/:id/run and the CSV
// export both use, so narrating it means picking those same rows up
// and phrasing them, not recomputing anything.
export const narrateReportSkill: AiSkill = {
  key: 'narrate_report',
  label: 'Narrate a saved report',
  requiredPermission: 'property:read',
  moduleContextPrefix: 'account',
  inputSchema: NARRATE_REPORT_INPUT_SCHEMA,

  async run(ctx, moduleContext, input, { reports, llm }) {
    const requestedAccountId = moduleContext.split(':')[1];
    if (requestedAccountId !== ctx.accountId) {
      throw new BadRequestException('A report can only be narrated for your own account');
    }

    const reportDefinitionId = input.reportDefinitionId as string;
    // runDefinition itself throws NotFoundException if the definition
    // doesn't exist or belongs to a different account — no need to
    // re-check ownership here.
    const { name, rows } = await reports.runDefinition(ctx.accountId, reportDefinitionId);

    const facts = rows.map((r) => `${r.label}: ${r.value}`).join('; ');
    const intro = await llm.complete({
      systemPrompt:
        "You write a short, plain-language paragraph narrating a saved report's own numbers for its owner, from the facts given only. Never invent a number that wasn't given.",
      userPrompt: rows.length === 0 ? `Report "${name}" has no metrics selected.` : `Report "${name}": ${facts}.`,
    });

    return {
      draftLabel: `${name} — narrated draft`,
      // No universal way to decide "warn" for an arbitrary, user-chosen
      // combination of metrics the way generate_portfolio_report can
      // key on its own fixed open-dispute count — always false here,
      // deliberately, not an oversight.
      items: [intro, ...rows.map((r) => `${r.label}: ${r.value}`)],
      warn: false,
    };
  },
};
