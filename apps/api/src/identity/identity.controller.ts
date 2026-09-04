import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IdentityService } from './identity.service';

type UserCtx = { id: string };

// User-scoped, not account-scoped — no AccountContextGuard/PermissionsGuard
// the way every other controller in this codebase has: identity
// verification is about the person signed in, independent of which
// account they currently have selected, the same reasoning
// AuthController's own GET /auth/me needs nothing more than JwtAuthGuard.
@UseGuards(JwtAuthGuard)
@Controller('identity')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Get('me')
  getStatus(@CurrentUser() user: UserCtx) {
    return this.identity.getStatus(user.id);
  }

  @Post('start')
  startVerification(@CurrentUser() user: UserCtx) {
    return this.identity.startVerification(user.id);
  }

  @Post('refresh')
  refreshStatus(@CurrentUser() user: UserCtx) {
    return this.identity.refreshStatus(user.id);
  }
}
