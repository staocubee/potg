import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService, AccountMemberWithRole } from './ai.service';
import { LLM_PROVIDER } from './llm/llm.constants';
import { LlmProvider } from './llm/llm-provider.interface';
import { SendChatMessageDto } from './dto/send-chat-message.dto';

const CHAT_SYSTEM_PROMPT =
  'You are the PropertyOnTheGo Ask AI assistant, embedded in the property owner\'s own data. ' +
  'When one of the tools you were given would answer the request, call it — do not describe what ' +
  'the tool would do instead of calling it. Otherwise reply in one or two plain, concrete sentences. ' +
  'Never claim to have taken an action you did not call a tool for.';

// The chat surface Section 5.1 asks for directly: "every feature should
// let the user chat ... from inside that feature", on top of the
// quick-action buttons the rest of this module already exposes one at a
// time. ChatService is deliberately a thin router, not a new permission or
// audit system of its own — every tool call it makes goes through
// AiService.runAction exactly as if the user had clicked the equivalent Ask
// AI button, so the same permission check and the same AiRequest/AiOutput/
// AiActionApproval trail applies whether an action was triggered by a
// click or by a sentence.
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  private async requireOwnConversation(conversationId: string, accountId: string) {
    const conversation = await this.prisma.aiConversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.accountId !== accountId) {
      throw new ForbiddenException('This conversation belongs to a different account');
    }
    return conversation;
  }

  async sendMessage(accountMember: AccountMemberWithRole, dto: SendChatMessageDto) {
    const conversation = dto.conversationId
      ? await this.requireOwnConversation(dto.conversationId, accountMember.accountId)
      : await this.prisma.aiConversation.create({
          data: {
            accountId: accountMember.accountId,
            accountMemberId: accountMember.id,
            moduleContext: dto.moduleContext,
            title: dto.message.slice(0, 80),
          },
        });

    await this.prisma.aiMessage.create({
      data: { conversationId: conversation.id, role: 'user', content: dto.message },
    });

    const history = await this.prisma.aiMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
    });

    // Only offer tools this account member could already reach directly —
    // the AI layer never sees more than the human already could (Section 8
    // applied identically here, not just on /ai/actions).
    const permissions = new Set(accountMember.role.permissions.map((rp) => rp.permission.key));
    const availableSkills = this.aiService.listSkills().filter((s) => permissions.has(s.requiredPermission));

    const result = await this.llm.chat({
      systemPrompt: CHAT_SYSTEM_PROMPT,
      messages: history.map((m: { role: string; content: string }) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      tools: availableSkills.map((s) => ({ name: s.key, description: s.label, inputSchema: s.inputSchema })),
    });

    let replyText: string;
    let toolName: string | undefined;
    let aiOutputId: string | undefined;

    if (result.type === 'tool_call') {
      toolName = result.toolName;
      const skill = availableSkills.find((s) => s.key === result.toolName);
      const moduleContext = dto.moduleContext ?? conversation.moduleContext ?? undefined;
      if (!skill) {
        replyText = `I tried to use "${result.toolName}", but that's not an action available to this account.`;
      } else if (!moduleContext) {
        replyText = `I'd use "${skill.label}" for that, but this conversation isn't scoped to anything yet — start a chat with a moduleContext like "${skill.moduleContextPrefix}:<id>" so I know what to act on.`;
      } else {
        // Deliberately one tool call per turn, reported straight to the
        // user rather than looped back into a second model call — keeps
        // this a single, auditable round trip instead of an open-ended
        // agent loop, and matches the "draft, then a human decides"
        // pattern every other Ask AI entry point already uses.
        try {
          const output = await this.aiService.runAction(accountMember, moduleContext, result.toolName, result.toolInput);
          aiOutputId = output.outputId;
          const itemLines = output.items.map((item: string) => `- ${item}`).join('\n');
          replyText = `${output.draftLabel}\n\n${itemLines}\n\n(This is a draft — accept, edit, or discard it with POST /ai/outputs/${output.outputId}/decision before it's final.)`;
        } catch (err) {
          replyText = `I couldn't run that: ${err instanceof Error ? err.message : 'unknown error'}`;
        }
      }
    } else {
      replyText = result.text;
    }

    const assistantMessage = await this.prisma.aiMessage.create({
      data: { conversationId: conversation.id, role: 'assistant', content: replyText, toolName, aiOutputId },
    });
    // Bumps AiConversation.updatedAt (Prisma refreshes @updatedAt on any
    // update() call) so listConversations can order by recent activity.
    await this.prisma.aiConversation.update({ where: { id: conversation.id }, data: {} });

    return { conversationId: conversation.id, message: assistantMessage };
  }

  listConversations(accountId: string) {
    return this.prisma.aiConversation.findMany({
      where: { accountId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getConversation(conversationId: string, accountId: string) {
    await this.requireOwnConversation(conversationId, accountId);
    return this.prisma.aiConversation.findUnique({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
  }
}
