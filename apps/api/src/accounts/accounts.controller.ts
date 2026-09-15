import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentUser, CurrentAccountMember } from '../common/decorators/current-user.decorator';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

type UserCtx = { id: string };
type AccountMemberCtx = { accountId: string };

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  // Creating an account has no account context yet — just needs a
  // signed-in user, who becomes that account's first member.
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() user: UserCtx, @Body() dto: CreateAccountDto) {
    return this.accounts.create(user.id, dto);
  }

  // Every nav audit's own repeated finding, once per role: "Settings —
  // missing." Real fields, never editable since creation — see
  // AccountsService.getSelf/updateSelf's own comment on why this is
  // deliberately not gated on account:manage_members. AccountContextGuard
  // alone already guarantees the caller is a real member of this exact
  // account — no :accountId param needed, "me" always means the acting
  // account.
  @UseGuards(JwtAuthGuard, AccountContextGuard)
  @Get('me')
  getSelf(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.accounts.getSelf(member.accountId);
  }

  @UseGuards(JwtAuthGuard, AccountContextGuard)
  @Patch('me')
  updateSelf(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: UpdateAccountDto) {
    return this.accounts.updateSelf(member.accountId, dto);
  }

  // Adding a member DOES need account context — the caller must be acting
  // as this account and hold "account:manage_members". PermissionsGuard
  // also checks :accountId itself matches the caller's own account (see
  // its comment — this route used to be a real IDOR without that check).
  @UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
  @RequirePermissions('account:manage_members')
  @Post(':accountId/members')
  addMember(@Param('accountId') accountId: string, @CurrentUser() user: UserCtx, @Body() dto: AddMemberDto) {
    return this.accounts.addMember(accountId, user.id, dto);
  }

  @UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
  @RequirePermissions('account:manage_members')
  @Get(':accountId/members')
  listMembers(@Param('accountId') accountId: string) {
    return this.accounts.listMembers(accountId);
  }

  // Kills a pending invite without replacing it — see
  // AccountsService.revokeInvite for what "Not built yet" this closes.
  @UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
  @RequirePermissions('account:manage_members')
  @Post(':accountId/invites/:inviteId/revoke')
  revokeInvite(@Param('accountId') accountId: string, @Param('inviteId') inviteId: string) {
    return this.accounts.revokeInvite(accountId, inviteId);
  }

  // Rotates a pending invite's token/expiry without needing its role
  // re-entered — see AccountsService.resendInvite.
  @UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
  @RequirePermissions('account:manage_members')
  @Post(':accountId/invites/:inviteId/resend')
  resendInvite(@Param('accountId') accountId: string, @Param('inviteId') inviteId: string, @CurrentUser() user: UserCtx) {
    return this.accounts.resendInvite(accountId, inviteId, user.id);
  }
}
