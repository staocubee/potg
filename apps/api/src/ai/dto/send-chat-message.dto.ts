import { IsOptional, IsString } from 'class-validator';

export class SendChatMessageDto {
  // Omit to start a new conversation; include to continue an existing one.
  @IsOptional()
  @IsString()
  conversationId?: string;

  // Required the first time a conversation needs to call a tool scoped to
  // an entity (e.g. "property:<id>") — set once, on the first message, and
  // carried by the conversation from then on. General portfolio chat (the
  // "account:<id>" prefixed skills, or plain text back-and-forth) can omit
  // it entirely.
  @IsOptional()
  @IsString()
  moduleContext?: string;

  @IsString()
  message!: string;
}
