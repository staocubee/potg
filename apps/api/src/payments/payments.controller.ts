import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember, CurrentUser } from '../common/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';
import { DepositDto } from './dto/deposit.dto';
import { RaiseDisputeDto } from './dto/raise-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { ArbitrateDisputeDto } from './dto/arbitrate-dispute.dto';
import { SubmitDisputeEvidenceDto } from './dto/submit-dispute-evidence.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { FinalizePayoutOtpDto } from './dto/finalize-payout-otp.dto';

type AccountMemberCtx = { accountId: string };
type UserCtx = { id: string; email: string };
// Module 21 Phase 1 — releaseMilestone needs more than accountId now: its
// own authorization check (role permission OR PropertyAccessGrant) needs
// this account member's own id and permission set.
type ApprovalMemberCtx = { accountId: string; id: string; role: { permissions: { permission: { key: string } }[] } };

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
    @CurrentUser() user: UserCtx,
    @Body() dto: DepositDto,
  ) {
    return this.payments.deposit(member.accountId, projectId, user.email, dto);
  }

  // The other half of the real Paystack path — see
  // PaymentsService.verifyDeposit. Same payment:write permission as
  // deposit itself: verifying is still the depositing account confirming
  // its own payment, not a neutral-reviewer action.
  @RequirePermissions('payment:write')
  @Post('payments/:paymentId/verify')
  verifyDeposit(
    @Param('projectId') projectId: string,
    @Param('paymentId') paymentId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
  ) {
    return this.payments.verifyDeposit(member.accountId, projectId, paymentId);
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

  // No @RequirePermissions here — see PaymentsService.releaseMilestone's
  // own comment. Role-based payment:approve is only one of two ways in
  // now (Module 21 Phase 1's own PropertyAccessGrant.canApprovePayments
  // is the other), so the real authorization check moved into the
  // service, which needs the caller's own role permissions and
  // accountMemberId to run it. AccountContextGuard's active-membership
  // check still runs regardless — this never opens the route to anyone
  // outside the project's own account, only widens who *within* it can
  // release funds.
  @Post('milestones/:milestoneId/release')
  releaseMilestone(
    @Param('projectId') projectId: string,
    @Param('milestoneId') milestoneId: string,
    @CurrentAccountMember() member: ApprovalMemberCtx,
  ) {
    return this.payments.releaseMilestone(projectId, milestoneId, member);
  }

  @RequirePermissions('payout:read')
  @Get('payouts')
  findPayouts(@Param('projectId') projectId: string) {
    return this.payments.findPayouts(projectId);
  }

  // The other half of the real Paystack payout path — see
  // PaymentsService.verifyPayout. Same payment:approve permission as
  // releasing itself: checking on a payout's real status is still the
  // owner-side action that moved money out of escrow in the first place.
  @RequirePermissions('payment:approve')
  @Post('payouts/:payoutId/verify')
  verifyPayout(@Param('projectId') projectId: string, @Param('payoutId') payoutId: string) {
    return this.payments.verifyPayout(projectId, payoutId);
  }

  // See PaymentsService.finalizePayoutOtp — relays an OTP Paystack sent
  // the account holder directly, for integrations that have transfer OTP
  // enabled (the default for a newly created Paystack account).
  @RequirePermissions('payment:approve')
  @Post('payouts/:payoutId/finalize')
  finalizePayoutOtp(
    @Param('projectId') projectId: string,
    @Param('payoutId') payoutId: string,
    @Body() dto: FinalizePayoutOtpDto,
  ) {
    return this.payments.finalizePayoutOtp(projectId, payoutId, dto.otp);
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

  // The structured "submit more evidence" channel — see
  // PaymentsService.submitDisputeEvidence/requireDisputeParty. Still
  // nested under /projects/:projectId like every other route here (so
  // PermissionsGuard's existing ABAC check keeps applying), but the
  // service call itself only ever needs disputeId — requireDisputeParty
  // re-derives and checks the dispute's own project independently, the
  // same shape VendorsController's identical route (below, via
  // vendors.controller.ts) relies on with no :projectId at all.
  @RequirePermissions('dispute:write')
  @Post('disputes/:disputeId/evidence')
  submitDisputeEvidence(
    @Param('disputeId') disputeId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @CurrentUser() user: UserCtx,
    @Body() dto: SubmitDisputeEvidenceDto,
  ) {
    return this.payments.submitDisputeEvidence(disputeId, member.accountId, user.id, dto);
  }

  @RequirePermissions('dispute:read')
  @Get('disputes/:disputeId/evidence')
  findDisputeEvidence(@Param('disputeId') disputeId: string, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.payments.findDisputeEvidence(disputeId, member.accountId);
  }

  @RequirePermissions('dispute:write')
  @Post('disputes/:disputeId/resolve')
  resolveDispute(
    @Param('projectId') projectId: string,
    @Param('disputeId') disputeId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.payments.resolveDispute(projectId, disputeId, member.accountId, dto);
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

  // Module 6's neutral-reviewer path for disputes — see
  // PaymentsService.findOpenDisputesForArbitration/arbitrateDispute. No
  // :projectId param for PermissionsGuard's ABAC to key on, so (like the
  // vendor/supplier verification routes) this reaches any dispute on the
  // platform once the caller's role has dispute:arbitrate.
  @RequirePermissions('dispute:arbitrate')
  @Get('disputes/open')
  findOpenDisputesForArbitration() {
    return this.payments.findOpenDisputesForArbitration();
  }

  @RequirePermissions('dispute:arbitrate')
  @Patch('disputes/:disputeId/arbitrate')
  arbitrateDispute(@Param('disputeId') disputeId: string, @Body() dto: ArbitrateDisputeDto) {
    return this.payments.arbitrateDispute(disputeId, dto);
  }
}
