import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember } from '../common/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';
import { DepositDto } from './dto/deposit.dto';
import { RaiseDisputeDto } from './dto/raise-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';

type AccountMemberCtx = { accountId: string };

// Controller-level :projectId (rather than each route repeating it) — same
// param name PermissionsGuard's ABAC check looks for, so every route here
// gets the same "this project belongs to the acting account" enforcement
// as ProjectsController without duplicating the check.
@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller('projects/:projectId')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @RequirePermissions('payment:write')
  @Post('payments')
  deposit(
    @Param('projectId') projectId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: DepositDto,
  ) {
    return this.payments.deposit(member.accountId, projectId, dto);
  }

  @RequirePermissions('payment:read')
  @Get('payments')
  findPayments(@Param('projectId') projectId: string) {
    return this.payments.findPayments(projectId);
  }

  @RequirePermissions('payment:read')
  @Get('escrow')
  getEscrow(@Param('projectId') projectId: string) {
    return this.payments.getEscrow(projectId);
  }

  @RequirePermissions('payment:approve')
  @Post('payments/:paymentId/refund')
  refundPayment(
    @Param('projectId') projectId: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: RefundPaymentDto,
  ) {
    return this.payments.refundPayment(projectId, paymentId, dto);
  }

  @RequirePermissions('milestone:write')
  @Post('milestones/:milestoneId/approve')
  approveMilestone(@Param('projectId') projectId: string, @Param('milestoneId') milestoneId: string) {
    return this.payments.approveMilestone(projectId, milestoneId);
  }

  @RequirePermissions('payment:approve')
  @Post('milestones/:milestoneId/release')
  releaseMilestone(@Param('projectId') projectId: string, @Param('milestoneId') milestoneId: string) {
    return this.payments.releaseMilestone(projectId, milestoneId);
  }

  @RequirePermissions('payout:read')
  @Get('payouts')
  findPayouts(@Param('projectId') projectId: string) {
    return this.payments.findPayouts(projectId);
  }

  @RequirePermissions('payment:read')
  @Get('receipts')
  findReceipts(@Param('projectId') projectId: string) {
    return this.payments.findReceipts(projectId);
  }

  @RequirePermissions('dispute:write')
  @Post('disputes')
  raiseDispute(
    @Param('projectId') projectId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: RaiseDisputeDto,
  ) {
    return this.payments.raiseDispute(member.accountId, projectId, dto);
  }

  @RequirePermissions('dispute:read')
  @Get('disputes')
  findDisputes(@Param('projectId') projectId: string) {
    return this.payments.findDisputes(projectId);
  }

  @RequirePermissions('dispute:write')
  @Post('disputes/:disputeId/resolve')
  resolveDispute(
    @Param('projectId') projectId: string,
    @Param('disputeId') disputeId: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.payments.resolveDispute(projectId, disputeId, dto);
  }
}

// The account-wide counterpart to PaymentsController above — everything up
// there is deliberately nested under one project (so PermissionsGuard's
// `:projectId` ABAC check applies automatically); this route isn't scoped
// to a project at all, so it filters by the caller's own accountId inside
// PaymentsService.getAccountOverview instead of relying on that convention.
// This is what finally backs the sidebar's "Payments" nav item, which
// previously had no standalone screen to link to.
@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller('payments')
export class AccountPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @RequirePermissions('payment:read')
  @Get('overview')
  getOverview(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.payments.getAccountOverview(member.accountId);
  }
}
