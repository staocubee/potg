// A JSON-Schema-shaped (but hand-rolled — no ajv/zod dependency added for
// this) description of the `input` object a skill's run() accepts. This is
// what "per-skill AI input schemas" closes: before this, AiSkill.run()
// took `input: Record<string, unknown>` with no declared shape anywhere,
// so (a) AnthropicLlmProvider.chat() sent every tool the same permissive
// `{ type: 'object', properties: {}, additionalProperties: true }` schema
// to the model regardless of what the skill actually read, meaning a real
// model had no idea model_roi_scenario takes a `scenario` field, and
// (b) nothing validated or coerced `input` before a skill used it — a
// stray string where a number was expected just silently became NaN deep
// inside a skill's math.
//
// AiSkillInputSchema is deliberately small: three primitive types, an
// optional enum for strings, optional min/max for numbers, and an optional
// default — enough to describe every skill in this registry today without
// pulling in a general-purpose schema library. It serializes directly as
// Anthropic's tool-calling `input_schema` (Section 16) and is also what
// AiService.coerceInput uses to validate/coerce input server-side, and what
// GET /ai/skills exposes so a client can render a parameter form instead of
// always calling a skill with `{}` (see apps/web's AskAiPanel).
export type AiSkillInputFieldType = 'string' | 'number' | 'boolean';

export interface AiSkillInputField {
  type: AiSkillInputFieldType;
  description: string;
  enum?: string[]; // only meaningful for type: 'string'
  minimum?: number; // only meaningful for type: 'number'
  maximum?: number; // only meaningful for type: 'number'
  default?: string | number | boolean;
}

export interface AiSkillInputSchema {
  type: 'object';
  properties: Record<string, AiSkillInputField>;
  required?: string[];
}

// Shared constant for the 11 of this registry's 12 skills that don't read
// `input` at all — every action they take comes from moduleContext plus
// the platform's own data, so there's nothing to declare. Only
// model_roi_scenario (apps/api/src/ai/skills/model-roi-scenario.skill.ts)
// has a real shape.
export const NO_INPUT_SCHEMA: AiSkillInputSchema = { type: 'object', properties: {} };
