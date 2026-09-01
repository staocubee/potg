import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { AddMemberDto } from './dto/add-member.dto';

type UserCtx = { id: string };

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
}
