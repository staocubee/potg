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
// Still deliberately minimal next to a full SDK's tool-use types — no
// parallel tool calls in one turn, no streaming — but ChatService now
// loops: a tool call's result is fed back to the model as a `tool_result`
// block (matching Anthropic's own tool-use protocol) so it can chain
// another tool call before finally replying in text, instead of the result
// being reported straight to the user as the last word. See the comment on
// ChatService.sendMessage for the loop and its safety cap.
export interface ChatToolDef {
  name: string; // matches an AiSkill.key
  description: string;
  inputSchema: AiSkillInputSchema; // AiSkill.inputSchema, passed straight through — see ai-skill-input-schema.ts
}

// A message's content is a plain string for ordinary user/assistant turns
// (what's actually persisted to AiMessage — see ChatService) — the block
// array form only appears in the in-memory scratch history ChatService
// builds up mid-loop, to carry a `tool_use` the model made and the
// `tool_result` ChatService ran for it, so the next model call can see
// what happened without that exchange ever being written to the database.
export type ChatContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ChatContentBlock[];
}

export interface ChatRequest {
  systemPrompt: string;
  messages: ChatMessage[];
  tools: ChatToolDef[];
}

export type ChatResult =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; toolUseId: string; toolName: string; toolInput: Record<string, unknown> };

export interface LlmProvider {
  readonly name: string;
  complete(request: LlmCompletionRequest): Promise<string>;
  chat(request: ChatRequest): Promise<ChatResult>;
}
