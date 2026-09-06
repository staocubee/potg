import { PrismaService } from '../../prisma/prisma.service';
import { LlmProvider } from '../llm/llm-provider.interface';
import { ReportsService } from '../../reports/reports.service';
import { AiSkillInputSchema } from './ai-skill-input-schema';

// This is the "skill/tool registry" from Section 5.4: one entry per module
// action the AI layer is allowed to take. Each skill declares the
// permission it requires (checked identically to any human action on the
// same data — Section 8's rule that the AI layer inherits the caller's
// scope exactly) and the moduleContext shape it expects, then reads
// whatever it needs through the same PrismaService the REST controllers
// use — no separate AI-only data path.
export interface AiSkillContext {
  accountId: string;
  accountMemberId: string;
  permissions: Set<string>;
}

export interface AiSkillDeps {
  prisma: PrismaService;
  llm: LlmProvider;
  // Every other skill reads only through `prisma`, duplicating whatever
  // small (10-20 line) computation it needs from a REST service rather
  // than sharing it (see model_roi_scenario's own comment on why). This
  // one exception exists for narrate_report, whose data source
  // (ReportsService.runDefinition — a fixed metric registry projecting
  // rows out of a 100+ line, cross-module portfolio computation) is
  // large enough that duplicating it would be the actual anti-pattern,
  // not sharing it.
  reports: ReportsService;
}

export interface AiSkillResult {
  draftLabel: string;
  items: string[];
  warn?: boolean; // true = the finding itself is a warning (Payments/Escrow's anomaly flag), not just a generated draft
}

export interface AiSkill {
  key: string; // actionType, e.g. "verify_property_documents"
  label: string;
  requiredPermission: string;
  moduleContextPrefix: string; // e.g. "property" — moduleContext must be "property:<id>"
  inputSchema: AiSkillInputSchema; // required so every skill states its shape explicitly, even when it's empty (NO_INPUT_SCHEMA)
  run(
    ctx: AiSkillContext,
    moduleContext: string,
    input: Record<string, unknown>,
    deps: AiSkillDeps,
  ): Promise<AiSkillResult>;
}
