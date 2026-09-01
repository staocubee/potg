import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember, CurrentUser } from '../common/decorators/current-user.decorator';
import { AiService } from './ai.service';
import { ChatService } from './chat.service';
import { RunAiActionDto } from './dto/run-ai-action.dto';
import { DecideAiOutputDto } from './dto/decide-ai-output.dto';
import { SendChatMessageDto } from './dto/send-chat-message.dto';

type AccountMemberCtx = {
  id: string;
  accountId: string;
  role: { permissions: { permission: { key: string } }[] };
};
type UserCtx = { id: string };

// Every route here is the server side of the Ask AI panel wireframe: a
// quick-action click is POST /ai/actions, Accept/Edit/Discard is POST
// /ai/outputs/:outputId/decision. "ai:act" is a baseline permission on top
// of the skill's own requiredPermission — see Section 8's note that the AI
// layer's access is a permission area like any other.
@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly chat: ChatService,
  ) {}

  @RequirePermissions('ai:act')
  @Get('skills')
  listSkills() {
    return this.ai.listSkills();
  }

  @RequirePermissions('ai:act')
  @Post('actions')
  runAction(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: RunAiActionDto) {
    return this.ai.runAction(member, dto.moduleContext, dto.actionType, dto.input ?? {});
  }

  @RequirePermissions('ai:act')
  @Post('outputs/:outputId/decision')
  decide(
    @CurrentUser() user: UserCtx,
    @Param('outputId') outputId: string,
    @Body() dto: DecideAiOutputDto,
  ) {
    return this.ai.decide(outputId, user.id, dto.decision, dto.notes);
  }

  // The chat surface — same "ai:act" gate as everything else here, plus
  // whatever permission the tool it ends up calling requires, checked
  // exactly as if that tool had been invoked directly via POST /ai/actions.
  @RequirePermissions('ai:act')
  @Post('chat')
  sendMessage(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: SendChatMessageDto) {
    return this.chat.sendMessage(member, dto);
  }

  @RequirePermissions('ai:act')
  @Get('conversations')
  listConversations(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.chat.listConversations(member.accountId);
  }

  @RequirePermissions('ai:act')
  @Get('conversations/:conversationId')
  getConversation(
    @Param('conversationId') conversationId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
  ) {
    return this.chat.getConversation(conversationId, member.accountId);
  }
}
