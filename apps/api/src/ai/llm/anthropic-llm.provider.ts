import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatRequest, ChatResult, LlmCompletionRequest, LlmProvider } from './llm-provider.interface';

// Live provider, used automatically once ANTHROPIC_API_KEY is set (see
// AiModule's factory). Calls the Messages API directly with fetch rather
// than pulling in the SDK, to keep this scaffold's dependency footprint
// small.
@Injectable()
export class AnthropicLlmProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly logger = new Logger(AnthropicLlmProvider.name);
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('ANTHROPIC_API_KEY', '');
    this.model = config.get<string>('ANTHROPIC_MODEL', 'claude-sonnet-4-5');
  }

  async complete(request: LlmCompletionRequest): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxTokens ?? 512,
        system: request.systemPrompt,
        messages: [{ role: 'user', content: request.userPrompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`Anthropic API error ${res.status}: ${body}`);
      throw new Error(`AI provider request failed (${res.status})`);
    }

    const data = (await res.json()) as { content: { type: string; text?: string }[] };
    return data.content.find((block) => block.type === 'text')?.text ?? '';
  }

  // Real tool-calling (Section 5.4/Section 16) — the model decides, from
  // the tool list ChatService hands it (already filtered to what the
  // caller's permissions allow), whether to reply in plain text or invoke
  // one skill by name. Each tool now carries its own AiSkill.inputSchema
  // (see ai-skill-input-schema.ts) as Anthropic's input_schema, so the
  // model actually knows model_roi_scenario takes a `scenario` enum plus
  // scenario-specific numbers, rather than being handed an anonymous open
  // object and left to guess. AiService.runAction still validates/coerces
  // whatever the model sends before any skill sees it — this schema makes
  // the model more likely to send something valid, it isn't the thing that
  // enforces validity.
  //
  // A ChatMessage's content can be the block-array form ChatService builds
  // mid-loop (a `tool_use` the model made plus the `tool_result` it got
  // back) — passed straight through to Anthropic's own content-block
  // format, mapping `toolUseId` to the `tool_use_id` field its
  // `tool_result` blocks expect.
  async chat(request: ChatRequest): Promise<ChatResult> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 768,
        system: request.systemPrompt,
        messages: request.messages.map((m) => ({
          role: m.role,
          content:
            typeof m.content === 'string'
              ? m.content
              : m.content.map((block) =>
                  block.type === 'tool_result'
                    ? { type: 'tool_result', tool_use_id: block.toolUseId, content: block.content }
                    : block,
                ),
        })),
        tools: request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`Anthropic API error ${res.status}: ${body}`);
      throw new Error(`AI provider request failed (${res.status})`);
    }

    const data = (await res.json()) as {
      content: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
    };
    const toolUse = data.content.find((block) => block.type === 'tool_use');
    if (toolUse?.name && toolUse.id) {
      return { type: 'tool_call', toolUseId: toolUse.id, toolName: toolUse.name, toolInput: toolUse.input ?? {} };
    }
    const text = data.content.find((block) => block.type === 'text')?.text ?? '';
    return { type: 'text', text };
  }
}
