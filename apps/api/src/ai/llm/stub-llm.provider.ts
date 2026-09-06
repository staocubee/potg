import { Injectable } from '@nestjs/common';
import { ChatMessage, ChatRequest, ChatResult, LlmCompletionRequest, LlmProvider } from './llm-provider.interface';

// A message's content is a plain string except inside ChatService's
// mid-loop scratch history, where a `tool_result` block stands in for the
// human's words — this stub only ever looks for keywords in actual typed
// text, so a tool_result (or any non-text block) just contributes nothing
// to search rather than crashing on `.toLowerCase()` of a non-string.
function textOf(message: ChatMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join(' ');
}

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
  summarize_project: ['summarize', 'summary', 'project health', 'how is this project', 'overview of'],
  draft_project_status_update: ['status update', 'progress update', 'draft an update'],
  compare_vendor_quotes: ['compare quote', 'compare vendor', 'which vendor', 'which quote'],
  explain_fees: ['fee', 'escrow', 'explain the charge', 'explain the balance'],
  flag_payment_anomaly: ['anomaly', 'suspicious payment', 'anything wrong with the payment'],
  generate_listing_description: ['listing description', 'write the listing', 'describe this listing'],
  boq_to_order: ['shopping list', 'order materials', 'materials list', 'turn this into an order'],
  model_roi_scenario: ['roi', 'yield', 'rent increase', 'what if i', 'appreciation', 'sell now'],
  estimate_comparable_value: ['comparable', 'comp value', 'market value', 'what is this worth', "what's this worth", 'estimate the value'],
  assess_project_risk: ['project risk', 'is this project at risk', 'risky project', 'project red flag', 'behind schedule'],
  assess_lease_risk: ['lease risk', 'tenant risk', 'risky tenant', 'lease red flag'],
  assess_listing_risk: ['risk', 'is this listing safe', 'red flag', 'safe to buy'],
  summarize_listing: ['summarize', 'summary', 'how is this listing doing', 'views and offers', 'listing performance'],
  generate_portfolio_report: ['portfolio report', 'across my properties', 'across all my properties'],
  summarize_inspection_history: ['inspection history', 'past inspections', 'inspection results', 'how did the inspection go'],
  summarize_lease_status: ['lease status', 'lease summary', 'is rent overdue', 'lease ending', 'tenant status'],
  summarize_maintenance_backlog: ['maintenance backlog', 'open maintenance', 'maintenance requests', 'anything urgent to fix'],
  explain_vendor_trust_score: ['vendor trust score', 'why does this vendor', 'is this vendor trustworthy'],
  explain_supplier_trust_score: ['supplier trust score', 'why does this supplier', 'is this supplier trustworthy'],
  summarize_rental_bookings: ['rental bookings', 'rental backlog', 'anything overdue for return', 'bookings awaiting confirmation'],
  assess_vendor_risk: ['vendor risk', 'is this vendor risky', 'risky vendor', 'vendor red flag', 'safe to hire'],
  assess_supplier_risk: ['supplier risk', 'is this supplier risky', 'risky supplier', 'supplier red flag'],
};

// Heuristic argument extraction for the stub provider — deliberately not
// a generic, schema-driven parser. `model_roi_scenario` is the only skill
// in this entire registry whose inputSchema declares anything beyond
// NO_INPUT_SCHEMA (see ai-skill-input-schema.ts's own comment — every
// other skill reads nothing from `input` at all, everything comes from
// moduleContext plus platform data), so a generic "walk the schema and
// regex for each field type" engine would be built for a registry of one
// real consumer. If a second skill grows a real schema, this is the
// place to reconsider that tradeoff — not before.
//
// Every number/keyword pulled out here is a plain regex over the same
// lowercased sentence KEYWORD_ROUTES already matched against — nothing
// clever, no NLP library, the same "demonstrate the tool-calling path,
// not be smart about it" philosophy the rest of this stub already
// follows. A real model (AnthropicLlmProvider) still does this properly;
// this only has to do better than always sending `{}`.
function extractModelRoiScenarioInput(text: string): Record<string, unknown> {
  const input: Record<string, unknown> = {};

  if (/sell now|sell vs\.? hold|hold or sell|sell or hold|hold for/.test(text)) {
    input.scenario = 'sell_now_vs_hold';
  } else if (/rent increase|increase (the )?rent|raise (the )?rent|rent by \d/.test(text)) {
    input.scenario = 'rent_increase';
  }

  // Tracks the character ranges consumed by a percentage or "N year(s)"
  // match, so the rent-amount search below can skip over them by
  // position instead of a regex lookahead — a first attempt using
  // `(?!\s*%)` backtracked onto a *partial* digit run (matching just the
  // "1" out of "15%") once the full "15" failed the lookahead, silently
  // producing a wrong number instead of no match. Caught live before
  // this ever shipped: "increase the rent by 15% to 500,000" produced
  // `currentMonthlyRent: 1`, not 500000.
  const consumed: [number, number][] = [];
  let match: RegExpExecArray | null;

  // Only one of these two percentages is ever meaningful per scenario
  // (rentIncreasePercent for rent_increase, appreciationRatePercent for
  // sell_now_vs_hold) — see MODEL_ROI_SCENARIO_INPUT_SCHEMA — so the last
  // percentage found is unambiguous once the scenario is known.
  const percentRe = /(\d+(?:\.\d+)?)\s*%/g;
  let percentValue: number | undefined;
  while ((match = percentRe.exec(text))) {
    consumed.push([match.index, match.index + match[0].length]);
    percentValue = Number(match[1]);
  }
  if (percentValue != null) {
    if (input.scenario === 'sell_now_vs_hold') input.appreciationRatePercent = percentValue;
    else input.rentIncreasePercent = percentValue;
  }

  const yearsRe = /(\d+(?:\.\d+)?)\s*year/g;
  let yearsValue: number | undefined;
  while ((match = yearsRe.exec(text))) {
    consumed.push([match.index, match.index + match[0].length]);
    yearsValue = Number(match[1]);
  }
  if (yearsValue != null) input.holdYears = yearsValue;

  // A rent *amount* (as opposed to rentIncreasePercent above) — the
  // largest freestanding number in the sentence that isn't part of an
  // already-consumed percentage/years match, only looked for at all when
  // "rent" appears somewhere in the sentence. Picking the largest, not
  // the nearest-to-"rent", because a real rent figure (hundreds/
  // thousands+) is reliably bigger than the percentages (≤500 per the
  // schema's own maximum) or hold-years (≤50) it needs to be
  // disambiguated from, and proximity-to-a-keyword is exactly the
  // brittle approach that produced the bug above.
  if (text.includes('rent')) {
    const numberRe = /[\d][\d,]*(?:\.\d+)?/g;
    let best: number | undefined;
    while ((match = numberRe.exec(text))) {
      if (consumed.some(([start, end]) => match!.index >= start && match!.index < end)) continue;
      const value = Number(match[0].replace(/,/g, ''));
      if (best == null || value > best) best = value;
    }
    if (best != null) input.currentMonthlyRent = best;
  }

  return input;
}

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
    // Mid-loop, the most *recent* user-role message is a tool_result (no
    // matchable text — see textOf) rather than the human's own words, so
    // finding "the last user message" has to skip past it to the human
    // sentence that started this turn — otherwise this stub could never
    // notice a second request in the same sentence once the first tool's
    // result took that slot, and would always fall through to the generic
    // reply after exactly one hop regardless of what else was asked.
    const lastUserMessage = [...request.messages].reverse().find((m) => m.role === 'user' && textOf(m).length > 0);
    const text = textOf(lastUserMessage ?? { role: 'user', content: '' }).toLowerCase();
    const offered = new Set(request.tools.map((t) => t.name));

    for (const [toolName, keywords] of Object.entries(KEYWORD_ROUTES)) {
      if (offered.has(toolName) && keywords.some((k) => text.includes(k))) {
        // Every tool carries a real inputSchema (see
        // ai-skill-input-schema.ts) a real model reads to pull structured
        // arguments out of the sentence — e.g. "model a 10% rent increase"
        // -> { scenario: "rent_increase", rentIncreasePercent: 10 }. This
        // keyword router only matches a tool *name*; extractModelRoiScenarioInput
        // above is the one heuristic exception, for the one skill in this
        // registry with a real (non-empty) schema — every other tool still
        // calls with `{}` and leans on its own schema defaults, correctly,
        // since there's nothing else to extract (see that function's own
        // comment for why this isn't generalized further).
        //
        // The keyword search re-scans the same original human sentence on
        // every loop turn (see the lastUserMessage lookup above), and
        // ChatService drops a tool from the offered set once it's been
        // called — so a sentence matching several keyword sets chains
        // through each of them in turn, same as a real model reasoning
        // over one request with several parts, until nothing offered
        // matches anymore and this falls through to a text reply.
        const toolInput = toolName === 'model_roi_scenario' ? extractModelRoiScenarioInput(text) : {};
        return { type: 'tool_call', toolUseId: `stub-${toolName}`, toolName, toolInput };
      }
    }

    const toolList = request.tools.map((t) => t.name).join(', ') || 'none available with your current permissions';
    return {
      type: 'text',
      text: `[stub response — set ANTHROPIC_API_KEY for a real model] I can help by running one of: ${toolList}. Try asking plainly, e.g. "compare the vendor quotes on this project."`,
    };
  }
}
