import { AiSkillInputSchema } from '../skills/ai-skill-input-schema';

// Provider-agnostic on purpose — Section 16 of the blueprint lists "an LLM
// provider with tool-calling/function-calling support" plus "provider
// redundancy" as the volume grows. Skills depend on this interface, never
// on a specific vendor SDK, so swapping or adding a provider later doesn't
// touch skill code.
export interface LlmCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

// --- Chat / tool-calling (Priority 6, Section 5.4) -----------------------
//
// Deliberately minimal next to a full SDK's tool-use types: one tool call
// per assistant turn, no parallel calls, no streaming. ChatService only
// ever executes the one tool call a turn returns and reports the result
// back to the user directly rather than looping the result back into the
// model for a second pass — see the comment on ChatService.sendMessage for
// why that boundary was drawn there.
export interface ChatToolDef {
  name: string; // matches an AiSkill.key
  description: string;
  inputSchema: AiSkillInputSchema; // AiSkill.inputSchema, passed straight through — see ai-skill-input-schema.ts
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  systemPrompt: string;
  messages: ChatMessage[];
  tools: ChatToolDef[];
}

export type ChatResult =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; toolName: string; toolInput: Record<string, unknown> };

export interface LlmProvider {
  readonly name: string;
  complete(request: LlmCompletionRequest): Promise<string>;
  chat(request: ChatRequest): Promise<ChatResult>;
}
