import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { CurrentAccountMember, CurrentUser } from '../common/decorators/current-user.decorator';
import { DevelopmentAgreementsService } from './development-agreements.service';

type UserCtx = { id: string; email: string };
type AccountMemberCtx = { accountId: string };

// The developer/recipient side — deliberately its own controller, not
// nested under /properties/:propertyId, same reasoning InvitesController
// gives for its own separation from AccountsController: the recipient
// isn't necessarily a member of (or even permitted to read) that
// property's own account yet, and for GET may not even be signed in.
@Controller('development-agreement-invites')
export class DevelopmentAgreementInvitesController {
  constructor(private readonly agreements: DevelopmentAgreementsService) {}

  // Registered before the :token catch-all — same ordering concern as
  // every other literal-vs-param route pair in this codebase (e.g.
  // InvitesController's own "mine" vs ":token").
  @UseGuards(JwtAuthGuard)
  @Get('mine')
  findMine(@CurrentUser() user: UserCtx) {
    return this.agreements.findMine(user.email);
  }

  @UseGuards(JwtAuthGuard, AccountContextGuard)
  @Post('mine/:agreementId/accept')
  acceptMine(@Param('agreementId') agreementId: string, @CurrentUser() user: UserCtx, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.agreements.acceptMine(agreementId, user.email, member.accountId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mine/:agreementId/decline')
  declineMine(@Param('agreementId') agreementId: string, @CurrentUser() user: UserCtx) {
    return this.agreements.declineMine(agreementId, user.email);
  }

  // Public — a not-yet-registered developer needs to see the deal terms
  // before deciding whether to log in or register. Gated only by the
  // token itself (32 random bytes, only its hash stored).
  @Get(':token')
  getByToken(@Param('token') token: string) {
    return this.agreements.getByToken(token);
  }

  @UseGuards(JwtAuthGuard, AccountContextGuard)
  @Post(':token/accept')
  accept(@Param('token') token: string, @CurrentUser() user: UserCtx, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.agreements.acceptByToken(token, user.email, member.accountId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':token/decline')
  decline(@Param('token') token: string, @CurrentUser() user: UserCtx) {
    return this.agreements.declineByToken(token, user.email);
  }
}
