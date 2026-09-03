import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService, AccountMemberWithRole } from './ai.service';
import { LLM_PROVIDER } from './llm/llm.constants';
import { ChatMessage, LlmProvider } from './llm/llm-provider.interface';
import { SendChatMessageDto } from './dto/send-chat-message.dto';

const CHAT_SYSTEM_PROMPT =
  'You are the PropertyOnTheGo Ask AI assistant, embedded in the property owner\'s own data. ' +
  'When one of the tools you were given would answer the request, call it — do not describe what ' +
  'the tool would do instead of calling it. You will see that tool\'s result and may call another ' +
  'tool afterward if the request genuinely needs more than one, or reply once you have enough. ' +
  'Reply in one or two plain, concrete sentences. Never claim to have taken an action you did not ' +
  'call a tool for.';

// The chat surface Section 5.1 asks for directly: "every feature should
// let the user chat ... from inside that feature", on top of the
// quick-action buttons the rest of this module already exposes one at a
// time. ChatService is deliberately a thin router, not a new permission or
// audit system of its own — every tool call it makes goes through
// AiService.runAction exactly as if the user had clicked the equivalent Ask
// AI button, so the same permission check and the same AiRequest/AiOutput/
// AiActionApproval trail applies whether an action was triggered by a
// click or by a sentence, no matter how many tool calls one chat turn ends
// up chaining.
@Injectable()
export class ChatService {
  // Caps how many tools one chat turn can chain before it's forced to
  // reply — an ordinary answer needs one or two; this just bounds the
  // worst case (a model that keeps finding "one more" thing to check) so
  // a single turn can't spin forever burning API calls and AiOutput rows.
  // Every call in the chain is still just a draft (AiService.runAction
  // never mutates real state — only a later, separate Accept does, see
  // AiService.decide), so the cap is a cost/latency guard, not a safety
  // one.
  private readonly MAX_CHAINED_TOOL_CALLS = 4;

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

  private persist(conversationId: string, content: string, toolName?: string, aiOutputId?: string) {
    return this.prisma.aiMessage.create({
      data: { conversationId, role: 'assistant', content, toolName, aiOutputId },
    });
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
    const moduleContext = dto.moduleContext ?? conversation.moduleContext ?? undefined;

    // In-memory scratch history for this call's model round trips, seeded
    // from the persisted conversation (plain-string content, same as
    // before) and grown with tool_use/tool_result content blocks as the
    // loop below runs — never written back to AiMessage itself, only each
    // step's own human-readable summary is (see ChatMessage's doc comment
    // for why the DB never needs to know about this scratch form).
    const messages: ChatMessage[] = history.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));
    // A tool already called this turn is dropped from what's offered next
    // — a well-behaved model has nothing left to repeat once it's covered
    // everything relevant, and it stops the keyword-matching stub provider
    // (which has no other way to know it already answered) from looping on
    // the same sentence until the cap below kicks it out.
    let offeredSkills = availableSkills;
    const persisted: Awaited<ReturnType<typeof this.persist>>[] = [];
    let reachedFinalReply = false;

    for (let turn = 0; turn < this.MAX_CHAINED_TOOL_CALLS; turn++) {
      const result = await this.llm.chat({
        systemPrompt: CHAT_SYSTEM_PROMPT,
        messages,
        tools: offeredSkills.map((s) => ({ name: s.key, description: s.label, inputSchema: s.inputSchema })),
      });

      if (result.type === 'text') {
        persisted.push(await this.persist(conversation.id, result.text));
        reachedFinalReply = true;
        break;
      }

      const skill = offeredSkills.find((s) => s.key === result.toolName);
      if (!skill) {
        persisted.push(
          await this.persist(
            conversation.id,
            `I tried to use "${result.toolName}", but that's not an action available to this account.`,
            result.toolName,
          ),
        );
        reachedFinalReply = true;
        break;
      }
      if (!moduleContext) {
        persisted.push(
          await this.persist(
            conversation.id,
            `I'd use "${skill.label}" for that, but this conversation isn't scoped to anything yet — start a chat with a moduleContext like "${skill.moduleContextPrefix}:<id>" so I know what to act on.`,
            result.toolName,
          ),
        );
        reachedFinalReply = true;
        break;
      }

      let stepText: string;
      let toolResultForModel: string;
      let aiOutputId: string;
      try {
        const output = await this.aiService.runAction(accountMember, moduleContext, result.toolName, result.toolInput);
        aiOutputId = output.outputId;
        const itemLines = output.items.map((item: string) => `- ${item}`).join('\n');
        stepText = `${output.draftLabel}\n\n${itemLines}\n\n(This is a draft — accept, edit, or discard it with POST /ai/outputs/${output.outputId}/decision before it's final.)`;
        toolResultForModel = `${output.draftLabel}\n${itemLines}`;
      } catch (err) {
        persisted.push(
          await this.persist(
            conversation.id,
            `I couldn't run that: ${err instanceof Error ? err.message : 'unknown error'}`,
            result.toolName,
          ),
        );
        reachedFinalReply = true;
        break;
      }

      persisted.push(await this.persist(conversation.id, stepText, result.toolName, aiOutputId));
      offeredSkills = offeredSkills.filter((s) => s.key !== result.toolName);

      if (offeredSkills.length === 0) {
        // Nothing left this account could call that it hasn't already —
        // synthesizing the close here saves one more round trip just to
        // have the model tell us the same thing.
        persisted.push(
          await this.persist(
            conversation.id,
            `I ran everything relevant above — see the draft${persisted.length > 1 ? 's' : ''} for details.`,
          ),
        );
        reachedFinalReply = true;
        break;
      }

      // Anthropic's tool-use protocol requires the assistant turn that
      // made the call to be replayed alongside the tool_result answering
      // it, not just the result on its own — see ChatContentBlock's doc
      // comment.
      messages.push({
        role: 'assistant',
        content: [{ type: 'tool_use', id: result.toolUseId, name: result.toolName, input: result.toolInput }],
      });
      messages.push({
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: result.toolUseId, content: toolResultForModel }],
      });
    }

    if (!reachedFinalReply) {
      // Hit MAX_CHAINED_TOOL_CALLS without the model ever settling on a
      // text reply — the drafts it already produced along the way are
      // still real and still shown above; this just closes the turn
      // instead of leaving the user waiting on a reply that isn't coming.
      persisted.push(
        await this.persist(
          conversation.id,
          `I ran ${this.MAX_CHAINED_TOOL_CALLS} actions in a row without reaching a final answer — see the drafts above, or ask a follow-up.`,
        ),
      );
    }

    // Bumps AiConversation.updatedAt (Prisma refreshes @updatedAt on any
    // update() call) so listConversations can order by recent activity.
    await this.prisma.aiConversation.update({ where: { id: conversation.id }, data: {} });

    return { conversationId: conversation.id, messages: persisted };
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
