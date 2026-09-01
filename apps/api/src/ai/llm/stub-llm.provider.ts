import { Injectable } from '@nestjs/common';
import { ChatRequest, ChatResult, LlmCompletionRequest, LlmProvider } from './llm-provider.interface';

// A very small keyword router so chat is genuinely useful without an API
// key, the same philosophy as complete()'s templated text: a real model
// would use its own judgment over the `tools` list it's handed; this stub
// just needs to demonstrate the tool-calling path, not be clever about it.
// Only matches tools the caller was actually offered (ChatService already
// filtered that list by permission), so this never "calls" something the
// account couldn't otherwise reach.
const KEYWORD_ROUTES: Record<string, string[]> = {
  verify_property_documents: ['verify', 'missing document', 'missing paper', 'checklist'],
  summarize_property: ['summarize', 'summary', 'overview of'],
  estimate_project_budget: ['estimate', 'budget', 'boq', 'bill of quantities'],
  draft_project_status_update: ['status update', 'progress update', 'draft an update'],
  compare_vendor_quotes: ['compare quote', 'compare vendor', 'which vendor', 'which quote'],
  explain_fees: ['fee', 'escrow', 'explain the charge', 'explain the balance'],
  flag_payment_anomaly: ['anomaly', 'suspicious payment', 'anything wrong with the payment'],
  generate_listing_description: ['listing description', 'write the listing', 'describe this listing'],
  boq_to_order: ['shopping list', 'order materials', 'materials list', 'turn this into an order'],
  model_roi_scenario: ['roi', 'yield', 'rent increase', 'what if i', 'appreciation', 'sell now'],
  assess_listing_risk: ['risk', 'is this listing safe', 'red flag', 'safe to buy'],
  generate_portfolio_report: ['portfolio report', 'across my properties', 'across all my properties'],
};

// Default provider when no ANTHROPIC_API_KEY is configured — lets the AI
// service, skill registry, and permission checks run and be tested end to
// end (including in this sandbox) without a live model call. Every skill's
// deterministic data assembly (what actually gets checked/flagged) still
// runs for real; only the narrative phrasing is templated.
@Injectable()
export class StubLlmProvider implements LlmProvider {
  readonly name = 'stub';

  async complete(request: LlmCompletionRequest): Promise<string> {
    return `${request.userPrompt} [stub response — set ANTHROPIC_API_KEY to use a real model]`;
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const lastUserMessage = [...request.messages].reverse().find((m) => m.role === 'user');
    const text = (lastUserMessage?.content ?? '').toLowerCase();
    const offered = new Set(request.tools.map((t) => t.name));

    for (const [toolName, keywords] of Object.entries(KEYWORD_ROUTES)) {
      if (offered.has(toolName) && keywords.some((k) => text.includes(k))) {
        // Every tool now carries a real inputSchema (see
        // ai-skill-input-schema.ts) that a real model would read to pull
        // structured arguments out of the sentence — e.g. "model a 10% rent
        // increase" -> { scenario: "rent_increase", rentIncreasePercent: 10
        // }. This keyword router only matches a tool name, it doesn't parse
        // free text into arguments, so it always calls with `{}` and leans
        // on each skill's own in-schema defaults (model_roi_scenario falls
        // back to the "current" scenario). Set ANTHROPIC_API_KEY for a
        // provider that actually extracts arguments from what was typed.
        return { type: 'tool_call', toolName, toolInput: {} };
      }
    }

    const toolList = request.tools.map((t) => t.name).join(', ') || 'none available with your current permissions';
    return {
      type: 'text',
      text: `[stub response — set ANTHROPIC_API_KEY for a real model] I can help by running one of: ${toolList}. Try asking plainly, e.g. "compare the vendor quotes on this project."`,
    };
  }
}
