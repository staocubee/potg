import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember, CurrentUser } from '../common/decorators/current-user.decorator';
import { VendorsService } from './vendors.service';
import { PaymentsService } from '../payments/payments.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { SubmitQuoteDto } from './dto/submit-quote.dto';
import { SubmitMaintenanceQuoteDto } from './dto/submit-maintenance-quote.dto';
import { RaiseDisputeAsVendorDto } from './dto/raise-dispute-as-vendor.dto';
import { ResolveDisputeDto } from '../payments/dto/resolve-dispute.dto';
import { SubmitDisputeEvidenceDto } from '../payments/dto/submit-dispute-evidence.dto';
import { ProposeResolutionDto } from '../payments/dto/propose-resolution.dto';
import { RespondToResolutionProposalDto } from '../payments/dto/respond-to-resolution-proposal.dto';
import { ReplyToReviewDto } from './dto/reply-to-review.dto';
import { SetVendorVerificationDto } from './dto/set-vendor-verification.dto';
import { SubmitVendorTrustAuditDto } from './dto/submit-vendor-trust-audit.dto';
import { SetVendorBankDetailsDto } from './dto/set-vendor-bank-details.dto';
import { SetPaypalPayoutEmailDto } from './dto/set-paypal-payout-email.dto';
import { SetVendorLicenseDto } from './dto/set-vendor-license.dto';
import { SetVendorPhotoDto } from './dto/set-vendor-photo.dto';
import { SubmitVendorVerificationEvidenceDto } from './dto/submit-vendor-verification-evidence.dto';
import { FlagReviewDto } from './dto/flag-review.dto';
import { ModerateReviewDto } from './dto/moderate-review.dto';

type AccountMemberCtx = { accountId: string };
type UserCtx = { id: string; email: string };

@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller('vendors')
export class VendorsController {
  constructor(
    private readonly vendors: VendorsService,
    private readonly payments: PaymentsService,
  ) {}

  @RequirePermissions('vendor:write')
  @Post()
  create(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: CreateVendorDto) {
    return this.vendors.create(member.accountId, dto);
  }

  // The real half of Section 16's payout integration — see
  // VendorsService.setBankDetails. dto.provider picks Paystack or
  // Flutterwave (defaults to "paystack").
  @RequirePermissions('vendor:write')
  @Patch('me/bank-details')
  setBankDetails(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: SetVendorBankDetailsDto) {
    return this.vendors.setBankDetails(member.accountId, dto);
  }

  // The PayPal counterpart — see VendorsService.setPaypalPayoutEmail.
  @RequirePermissions('vendor:write')
  @Patch('me/paypal-payout-email')
  setPaypalPayoutEmail(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: SetPaypalPayoutEmailDto) {
    return this.vendors.setPaypalPayoutEmail(member.accountId, dto);
  }

  // Self-reported professional license — see VendorsService.setLicense.
  // Same vendor:write gate create()/setBankDetails() already use — the
  // vendor's own account, never a reviewer.
  @RequirePermissions('vendor:write')
  @Patch('me/license')
  setLicense(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: SetVendorLicenseDto) {
    return this.vendors.setLicense(member.accountId, dto);
  }

  // The vendor's own profile photo — see VendorsService.setPhoto.
  @RequirePermissions('vendor:write')
  @Patch('me/photo')
  setPhoto(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: SetVendorPhotoDto) {
    return this.vendors.setPhoto(member.accountId, dto);
  }

  // The structured "submit more evidence" channel — see
  // VendorsService.submitVerificationEvidence's own comment. vendor:write,
  // same gate as setLicense above — the vendor's own account, never a
  // reviewer.
  @RequirePermissions('vendor:write')
  @Post('me/verification-evidence')
  submitVerificationEvidence(
    @CurrentAccountMember() member: AccountMemberCtx,
    @CurrentUser() user: UserCtx,
    @Body() dto: SubmitVendorVerificationEvidenceDto,
  ) {
    return this.vendors.submitVerificationEvidence(member.accountId, user.id, dto);
  }

  @RequirePermissions('vendor:write')
  @Get('me/verification-evidence')
  findMyVerificationEvidence(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.vendors.findMyVerificationEvidence(member.accountId);
  }

  // ?provider=flutterwave for Flutterwave's own (different) bank list —
  // omitted/anything else defaults to Paystack's, same default
  // setBankDetails uses.
  @RequirePermissions('vendor:read')
  @Get('banks')
  listBanks(@Query('provider') provider?: string) {
    return this.vendors.listBanks(provider);
  }

  // Marketplace browse (Module 7): ?serviceCategory=plumbing, ?q=... for
  // fuzzy free-text search against businessName, and now ?location=,
  // ?minRating=, ?verificationStatus= — see VendorsService.findAll's own
  // comment on the three-filter addition.
  @RequirePermissions('vendor:read')
  @Get()
  findAll(
    @Query('serviceCategory') serviceCategory?: string,
    @Query('q') q?: string,
    @Query('location') location?: string,
    @Query('minRating') minRating?: string,
    @Query('verificationStatus') verificationStatus?: string,
  ) {
    return this.vendors.findAll(serviceCategory, q, location, minRating, verificationStatus);
  }

  @RequirePermissions('vendor:read')
  @Get('me')
  findMine(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.vendors.findForAccount(member.accountId);
  }

  @RequirePermissions('quote:read')
  @Get('me/quotes')
  myQuotes(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.vendors.myQuotes(member.accountId);
  }

  @RequirePermissions('payout:read')
  @Get('me/payouts')
  myPayouts(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.vendors.myPayouts(member.accountId);
  }

  // The projects this vendor is actually hired onto (a real
  // ProjectVendorAssignment, not just a submitted quote) — the entry
  // point vendors/me.tsx never had, even though ProjectsController
  // already lets an assigned vendor reach GET /projects/:projectId and
  // post updates via @AllowAssignedVendor().
  @RequirePermissions('project:read')
  @Get('me/projects')
  myProjects(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.vendors.myProjects(member.accountId);
  }

  // Vendor-initiated: submit or revise a quote on a project that isn't this
  // account's own — deliberately not /projects/:projectId/... so it never
  // hits PermissionsGuard's project-ownership ABAC check.
  @RequirePermissions('quote:write')
  @Post('me/quotes')
  submitQuote(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: SubmitQuoteDto) {
    return this.vendors.submitQuote(member.accountId, dto);
  }

  // The maintenance-side counterpart to me/projects above — see
  // VendorsService.myMaintenanceRequests's own comment.
  @RequirePermissions('maintenance:read')
  @Get('me/maintenance-requests')
  myMaintenanceRequests(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.vendors.myMaintenanceRequests(member.accountId);
  }

  // The audit's own finding on Workflow 7: "VendorQuote ties only to
  // Project, never to a MaintenanceRequest — no quote mechanism for a
  // maintenance ticket exists." Reuses quote:write, same permission
  // me/quotes already checks — same reasoning: this is a quote, just on a
  // different resource, not a new capability.
  @RequirePermissions('quote:write')
  @Post('me/maintenance-quotes')
  submitMaintenanceQuote(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: SubmitMaintenanceQuoteDto) {
    return this.vendors.submitMaintenanceQuote(member.accountId, dto);
  }

  // Vendor-side dispute access — same reasoning as submitQuote above:
  // these routes never key off :projectId, so PermissionsGuard's ABAC
  // never blocks a vendor acting on a project it doesn't own. Before this
  // pass a vendor had dispute:read/dispute:write in its role but no route
  // to use it on — the /projects/:projectId/disputes routes 404 for any
  // account that isn't the project's owner.
  @RequirePermissions('dispute:read')
  @Get('me/disputes')
  myDisputes(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.payments.findDisputesForVendor(member.accountId);
  }

  @RequirePermissions('dispute:write')
  @Post('me/disputes')
  raiseDispute(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: RaiseDisputeAsVendorDto) {
    return this.payments.raiseDisputeAsVendor(member.accountId, dto);
  }

  @RequirePermissions('dispute:write')
  @Post('me/disputes/:disputeId/resolve')
  resolveDispute(
    @CurrentAccountMember() member: AccountMemberCtx,
    @Param('disputeId') disputeId: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.payments.resolveDisputeAsVendor(member.accountId, disputeId, dto);
  }

  // The vendor-side counterpart to PaymentsController's identical route —
  // see PaymentsService.submitDisputeEvidence/requireDisputeParty, which
  // both sides funnel into.
  @RequirePermissions('dispute:write')
  @Post('me/disputes/:disputeId/evidence')
  submitDisputeEvidence(
    @CurrentAccountMember() member: AccountMemberCtx,
    @CurrentUser() user: UserCtx,
    @Param('disputeId') disputeId: string,
    @Body() dto: SubmitDisputeEvidenceDto,
  ) {
    return this.payments.submitDisputeEvidence(disputeId, member.accountId, user.id, dto);
  }

  @RequirePermissions('dispute:read')
  @Get('me/disputes/:disputeId/evidence')
  findDisputeEvidence(@CurrentAccountMember() member: AccountMemberCtx, @Param('disputeId') disputeId: string) {
    return this.payments.findDisputeEvidence(disputeId, member.accountId);
  }

  // The vendor-side counterpart to PaymentsController's identical
  // proposal routes — see PaymentsService.proposeResolution/
  // respondToResolutionProposal, which both sides funnel into. This is
  // the vendor's own real path to propose a resolution, something the
  // older resolveDispute route above never let it do on a dispute it
  // raised itself.
  @RequirePermissions('dispute:write')
  @Post('me/disputes/:disputeId/proposals')
  proposeResolution(
    @CurrentAccountMember() member: AccountMemberCtx,
    @Param('disputeId') disputeId: string,
    @Body() dto: ProposeResolutionDto,
  ) {
    return this.payments.proposeResolution(disputeId, member.accountId, dto);
  }

  @RequirePermissions('dispute:read')
  @Get('me/disputes/:disputeId/proposals')
  findResolutionProposals(@CurrentAccountMember() member: AccountMemberCtx, @Param('disputeId') disputeId: string) {
    return this.payments.findResolutionProposals(disputeId, member.accountId);
  }

  @RequirePermissions('dispute:write')
  @Post('me/disputes/:disputeId/proposals/:proposalId/respond')
  respondToResolutionProposal(
    @CurrentAccountMember() member: AccountMemberCtx,
    @Param('disputeId') disputeId: string,
    @Param('proposalId') proposalId: string,
    @Body() dto: RespondToResolutionProposalDto,
  ) {
    return this.payments.respondToResolutionProposal(disputeId, proposalId, member.accountId, dto);
  }

  // The vendor's own reply to a review on its profile — see the comment on
  // VendorsService.replyToReview. review:respond is separate from
  // review:write (which only ever gated *leaving* a review) since this is
  // the other party to the review, granted to the vendor/supplier roles
  // instead of the account-admin roles.
  @RequirePermissions('review:respond')
  @Post('me/reviews/:reviewId/reply')
  replyToReview(
    @CurrentAccountMember() member: AccountMemberCtx,
    @Param('reviewId') reviewId: string,
    @Body() dto: ReplyToReviewDto,
  ) {
    return this.vendors.replyToReview(member.accountId, reviewId, dto);
  }

  // The report side of the "no report/flag mechanism" gap — see
  // VendorsService.flagReview. Same review:respond-shaped ownership check
  // as replying, its own permission so a role can carry one without the
  // other (a viewer-style role could conceivably flag without being able
  // to write a reply, though no seeded role currently splits them).
  @RequirePermissions('review:flag')
  @Post('me/reviews/:reviewId/flag')
  flagReview(
    @CurrentAccountMember() member: AccountMemberCtx,
    @Param('reviewId') reviewId: string,
    @Body() dto: FlagReviewDto,
  ) {
    return this.vendors.flagReview(member.accountId, reviewId, dto);
  }

  // Module 6's neutral-reviewer queue for flagged reviews — see
  // VendorsService.findFlaggedReviews. Must be registered before
  // GET :vendorId below so "reviews" doesn't get swallowed as a vendor id.
  @RequirePermissions('review:moderate')
  @Get('reviews/flagged')
  findFlaggedReviews() {
    return this.vendors.findFlaggedReviews();
  }

  @RequirePermissions('review:moderate')
  @Patch('reviews/:reviewId/moderate')
  moderateReview(@Param('reviewId') reviewId: string, @Body() dto: ModerateReviewDto) {
    return this.vendors.moderateReview(reviewId, dto);
  }

  @RequirePermissions('vendor:read')
  @Get(':vendorId')
  findOne(@Param('vendorId') vendorId: string) {
    return this.vendors.findOne(vendorId);
  }

  // Module 6's neutral-reviewer action — see VendorsService.setVerificationStatus.
  @RequirePermissions('vendor:verify')
  @Patch(':vendorId/verification')
  setVerificationStatus(@Param('vendorId') vendorId: string, @Body() dto: SetVendorVerificationDto) {
    return this.vendors.setVerificationStatus(vendorId, dto);
  }

  // The reviewer's own view of submitted evidence — same vendor:verify
  // gate as setVerificationStatus itself, reaches any vendor platform-wide.
  @RequirePermissions('vendor:verify')
  @Get(':vendorId/verification-evidence')
  findVerificationEvidence(@Param('vendorId') vendorId: string) {
    return this.vendors.findVerificationEvidence(vendorId);
  }

  // The real audit step — see VendorsService.submitTrustAudit. Same
  // vendor:verify gate as verification itself.
  @RequirePermissions('vendor:verify')
  @Post(':vendorId/trust-audits')
  submitTrustAudit(
    @Param('vendorId') vendorId: string,
    @CurrentUser() user: UserCtx,
    @Body() dto: SubmitVendorTrustAuditDto,
  ) {
    return this.vendors.submitTrustAudit(vendorId, user.id, dto);
  }

  @RequirePermissions('vendor:read')
  @Get(':vendorId/trust-audits')
  findTrustAudits(@Param('vendorId') vendorId: string) {
    return this.vendors.findTrustAudits(vendorId);
  }
}
