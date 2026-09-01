import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AccountsService } from './accounts.service';

type UserCtx = { id: string; email: string };

// Deliberately its own controller, not nested under /accounts/:accountId —
// the whole point is a recipient who isn't a member of that account yet
// (and, for GET, may not even be signed in yet), so there's no account
// context to gate these behind.
@Controller('invites')
export class InvitesController {
  constructor(private readonly accounts: AccountsService) {}

  // Public on purpose — a not-yet-registered recipient needs to see what
  // they're being invited into before deciding whether to log in or
  // register. The token itself (32 random bytes, only its hash stored) is
  // the only thing that gates this.
  @Get(':token')
  getInvite(@Param('token') token: string) {
    return this.accounts.getInvite(token);
  }

  // For an already-registered, already-signed-in recipient. A brand-new
  // user instead passes the same token as RegisterDto.inviteToken and
  // this route is never called — see AuthService.register.
  @UseGuards(JwtAuthGuard)
  @Post(':token/accept')
  accept(@Param('token') token: string, @CurrentUser() user: UserCtx) {
    return this.accounts.acceptInvite(token, user.id, user.email);
  }
}
