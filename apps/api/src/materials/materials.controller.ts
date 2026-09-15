import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember, CurrentUser } from '../common/decorators/current-user.decorator';
import { MaterialsService } from './materials.service';
import { PaymentsService } from '../payments/payments.service';
import { RaiseOrderDisputeDto } from '../payments/dto/raise-order-dispute.dto';
import { ResolveDisputeDto } from '../payments/dto/resolve-dispute.dto';
import { SubmitDisputeEvidenceDto } from '../payments/dto/submit-dispute-evidence.dto';
import { ProposeResolutionDto } from '../payments/dto/propose-resolution.dto';
import { RespondToResolutionProposalDto } from '../payments/dto/respond-to-resolution-proposal.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { SetOrderApprovalDto } from './dto/set-order-approval.dto';
import { UpdateDeliveryDto } from './dto/update-delivery.dto';
import { CreateOrderReviewDto } from './dto/create-order-review.dto';
import { UpdateOrderReviewDto } from './dto/update-order-review.dto';
import { ReplyToReviewDto } from '../vendors/dto/reply-to-review.dto';
import { FlagReviewDto } from '../vendors/dto/flag-review.dto';
import { ModerateReviewDto } from '../vendors/dto/moderate-review.dto';
import { SetSupplierVerificationDto } from './dto/set-supplier-verification.dto';
import { SubmitSupplierVerificationEvidenceDto } from './dto/submit-supplier-verification-evidence.dto';
import { SubmitSupplierTrustAuditDto } from './dto/submit-supplier-trust-audit.dto';
import { CreateRentalBookingDto } from './dto/create-rental-booking.dto';
import { UpsertCartItemDto } from './dto/upsert-cart-item.dto';
import { CheckoutCartDto } from './dto/checkout-cart.dto';
import { RequestBulkQuoteDto } from './dto/request-bulk-quote.dto';
import { RespondBulkQuoteDto } from './dto/respond-bulk-quote.dto';
import { CheckoutOrderDto } from './dto/checkout-order.dto';

type AccountMemberCtx = { accountId: string };
type UserCtx = { id: string; email: string };

// No :propertyId/:projectId route params here either (orders carry an
// optional projectId in the body, not the URL) — every ownership check in
// this module happens in MaterialsService, same reasoning as
// ListingsController.
@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller()
export class MaterialsController {
  constructor(
    private readonly materials: MaterialsService,
    private readonly payments: PaymentsService,
  ) {}

  @RequirePermissions('supplier:write')
  @Post('suppliers')
  createSupplier(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: CreateSupplierDto) {
    return this.materials.createSupplier(member.accountId, dto);
  }

  @RequirePermissions('supplier:read')
  @Get('suppliers')
  findSuppliers(@Query('category') category?: string) {
    return this.materials.findSuppliers(category);
  }

  @RequirePermissions('supplier:read')
  @Get('suppliers/me')
  findMySupplier(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.materials.findMySupplier(member.accountId);
  }

  // The structured "submit more evidence" channel — see
  // MaterialsService.submitVerificationEvidence's own comment.
  // supplier:write, the account's own action, never a reviewer's.
  @RequirePermissions('supplier:write')
  @Post('suppliers/me/verification-evidence')
  submitVerificationEvidence(
    @CurrentAccountMember() member: AccountMemberCtx,
    @CurrentUser() user: UserCtx,
    @Body() dto: SubmitSupplierVerificationEvidenceDto,
  ) {
    return this.materials.submitVerificationEvidence(member.accountId, user.id, dto);
  }

  @RequirePermissions('supplier:write')
  @Get('suppliers/me/verification-evidence')
  findMyVerificationEvidence(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.materials.findMyVerificationEvidence(member.accountId);
  }

  @RequirePermissions('order:read')
  @Get('suppliers/me/orders')
  findOrdersForSupplier(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.materials.findOrdersForSupplier(member.accountId);
  }

  @RequirePermissions('product:write')
  @Post('suppliers/me/products')
  createProduct(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: CreateProductDto) {
    return this.materials.createProduct(member.accountId, dto);
  }

  @RequirePermissions('product:write')
  @Patch('suppliers/me/products/:productId')
  updateProduct(
    @Param('productId') productId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: UpdateProductDto,
  ) {
    return this.materials.updateProduct(member.accountId, productId, dto);
  }

  @RequirePermissions('supplier:read')
  @Get('suppliers/:supplierId')
  findSupplier(@Param('supplierId') supplierId: string) {
    return this.materials.findSupplier(supplierId);
  }

  // Module 6's neutral-reviewer action — see MaterialsService.setSupplierVerificationStatus.
  @RequirePermissions('supplier:verify')
  @Patch('suppliers/:supplierId/verification')
  setSupplierVerificationStatus(@Param('supplierId') supplierId: string, @Body() dto: SetSupplierVerificationDto) {
    return this.materials.setSupplierVerificationStatus(supplierId, dto);
  }

  // The reviewer's own view of submitted evidence — same supplier:verify
  // gate as verification itself, reaches any supplier platform-wide.
  @RequirePermissions('supplier:verify')
  @Get('suppliers/:supplierId/verification-evidence')
  findVerificationEvidence(@Param('supplierId') supplierId: string) {
    return this.materials.findVerificationEvidence(supplierId);
  }

  // The real audit step — see MaterialsService.submitTrustAudit. Same
  // supplier:verify gate as verification itself.
  @RequirePermissions('supplier:verify')
  @Post('suppliers/:supplierId/trust-audits')
  submitTrustAudit(
    @Param('supplierId') supplierId: string,
    @CurrentUser() user: UserCtx,
    @Body() dto: SubmitSupplierTrustAuditDto,
  ) {
    return this.materials.submitTrustAudit(supplierId, user.id, dto);
  }

  @RequirePermissions('supplier:read')
  @Get('suppliers/:supplierId/trust-audits')
  findTrustAudits(@Param('supplierId') supplierId: string) {
    return this.materials.findTrustAudits(supplierId);
  }

  // Public catalog browse/search across suppliers — ?q=... for fuzzy
  // free-text search against name/description, see
  // MaterialsService.findProducts's own comment.
  @RequirePermissions('product:read')
  @Get('products')
  findProducts(@Query('category') category?: string, @Query('supplierId') supplierId?: string, @Query('q') q?: string) {
    return this.materials.findProducts(category, supplierId, q);
  }

  // The audit's own finding on Workflow 6: "No compare-suppliers UI or
  // endpoint — the product grid shows one supplier per card, no
  // side-by-side view." Registered before :productId below so "compare"
  // is never swallowed as a productId — Nest matches routes in
  // registration order.
  @RequirePermissions('product:read')
  @Get('products/compare')
  compareProducts(@Query('ids') ids?: string) {
    return this.materials.compareProducts((ids ?? '').split(',').filter(Boolean));
  }

  @RequirePermissions('product:read')
  @Get('products/:productId')
  findProduct(@Param('productId') productId: string) {
    return this.materials.findProduct(productId);
  }

  @RequirePermissions('order:write')
  @Post('orders')
  createOrder(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: CreateOrderDto) {
    return this.materials.createOrder(member.accountId, dto);
  }

  // --- Bulk quote requests -------------------------------------------------

  @RequirePermissions('order:write')
  @Post('products/:productId/bulk-quote-requests')
  requestBulkQuote(
    @Param('productId') productId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: RequestBulkQuoteDto,
  ) {
    return this.materials.requestBulkQuote(member.accountId, productId, dto);
  }

  @RequirePermissions('order:read')
  @Get('bulk-quote-requests/me')
  myBulkQuoteRequests(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.materials.myBulkQuoteRequests(member.accountId);
  }

  @RequirePermissions('order:read')
  @Get('suppliers/me/bulk-quote-requests')
  findSupplierBulkQuoteRequests(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.materials.findSupplierBulkQuoteRequests(member.accountId);
  }

  @RequirePermissions('order:write')
  @Patch('bulk-quote-requests/:requestId/respond')
  respondToBulkQuote(
    @Param('requestId') requestId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: RespondBulkQuoteDto,
  ) {
    return this.materials.respondToBulkQuote(member.accountId, requestId, dto);
  }

  @RequirePermissions('order:write')
  @Post('bulk-quote-requests/:requestId/accept')
  acceptBulkQuote(@Param('requestId') requestId: string, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.materials.acceptBulkQuote(member.accountId, requestId);
  }

  @RequirePermissions('order:write')
  @Post('bulk-quote-requests/:requestId/decline')
  declineBulkQuote(@Param('requestId') requestId: string, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.materials.declineBulkQuote(member.accountId, requestId);
  }

  // --- Cart (server-side) --------------------------------------------------

  @RequirePermissions('order:read')
  @Get('cart')
  getCart(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.materials.getCart(member.accountId);
  }

  @RequirePermissions('order:write')
  @Post('cart/items')
  upsertCartItem(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: UpsertCartItemDto) {
    return this.materials.upsertCartItem(member.accountId, dto);
  }

  @RequirePermissions('order:write')
  @Delete('cart/items/:productId')
  removeCartItem(@Param('productId') productId: string, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.materials.removeCartItem(member.accountId, productId);
  }

  @RequirePermissions('order:write')
  @Post('cart/checkout')
  checkoutCart(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: CheckoutCartDto) {
    return this.materials.checkoutCart(member.accountId, dto);
  }

  // --- Rental bookings (Module 10) ---------------------------------------

  @RequirePermissions('rental:write')
  @Post('products/:productId/rental-bookings')
  createRentalBooking(
    @Param('productId') productId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: CreateRentalBookingDto,
  ) {
    return this.materials.createRentalBooking(member.accountId, productId, dto);
  }

  @RequirePermissions('rental:read')
  @Get('rental-bookings/me')
  findMyRentalBookings(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.materials.findMyRentalBookings(member.accountId);
  }

  @RequirePermissions('rental:read')
  @Get('suppliers/me/rental-bookings')
  findSupplierRentalBookings(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.materials.findSupplierRentalBookings(member.accountId);
  }

  @RequirePermissions('rental:write')
  @Post('rental-bookings/:bookingId/confirm')
  confirmRentalBooking(@Param('bookingId') bookingId: string, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.materials.confirmRentalBooking(member.accountId, bookingId);
  }

  @RequirePermissions('rental:write')
  @Post('rental-bookings/:bookingId/return')
  returnRentalBooking(@Param('bookingId') bookingId: string, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.materials.returnRentalBooking(member.accountId, bookingId);
  }

  @RequirePermissions('rental:write')
  @Post('rental-bookings/:bookingId/cancel')
  cancelRentalBooking(@Param('bookingId') bookingId: string, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.materials.cancelRentalBooking(member.accountId, bookingId);
  }

  @RequirePermissions('order:read')
  @Get('orders')
  findOrdersForBuyer(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.materials.findOrdersForBuyer(member.accountId);
  }

  @RequirePermissions('order:read')
  @Get('orders/:orderId')
  findOrder(@Param('orderId') orderId: string, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.materials.findOrder(orderId, member.accountId);
  }

  @RequirePermissions('order:write')
  @Patch('orders/:orderId/status')
  updateOrderStatus(
    @Param('orderId') orderId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.materials.updateOrderStatus(orderId, member.accountId, dto);
  }

  // The buyer's own side of the spend-approval gate above — payment:approve,
  // reused rather than a new permission (see MaterialsService.
  // setOrderApproval's own comment).
  @RequirePermissions('payment:approve')
  @Patch('orders/:orderId/approval')
  setOrderApproval(
    @Param('orderId') orderId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: SetOrderApprovalDto,
  ) {
    return this.materials.setOrderApproval(orderId, member.accountId, dto);
  }

  // The other half of the audit's own finding on Order.approvalStatus
  // above: "no gateway call, no charge on order creation." order:write —
  // the same permission that already governs creating this order in the
  // first place — not payment:approve, since paying is the buyer's own
  // ordinary action, not the separate spend-authority sign-off above.
  @RequirePermissions('order:write')
  @Post('orders/:orderId/payment')
  payOrder(
    @Param('orderId') orderId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @CurrentUser() user: UserCtx,
    @Body() dto: CheckoutOrderDto,
  ) {
    return this.materials.payOrder(orderId, member.accountId, user.email, dto.provider);
  }

  // The other half of the real gateway path — see
  // MaterialsService.verifyOrderPayment's own comment.
  @RequirePermissions('order:write')
  @Post('orders/:orderId/payment/verify')
  verifyOrderPayment(@Param('orderId') orderId: string, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.materials.verifyOrderPayment(orderId, member.accountId);
  }

  @RequirePermissions('order:write')
  @Patch('orders/:orderId/delivery')
  upsertDelivery(
    @Param('orderId') orderId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: UpdateDeliveryDto,
  ) {
    return this.materials.upsertDelivery(orderId, member.accountId, dto);
  }

  // The buyer's own counterpart to the supplier-only route above — see
  // MaterialsService.confirmReceipt's own comment. Deliberately not
  // nested under requireOwnSupplier like upsertDelivery: this account is
  // the order's buyer, never its supplier.
  @RequirePermissions('order:write')
  @Post('orders/:orderId/confirm-receipt')
  confirmReceipt(@Param('orderId') orderId: string, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.materials.confirmReceipt(orderId, member.accountId);
  }

  // Module 18 Phase 1 — the buyer/supplier dispute routes for an order.
  // One unified path for both sides (see PaymentsService.
  // requireOrderParty's own comment for why, unlike the project-dispute
  // pair of owner-side/vendor-side routes) — this controller injects
  // PaymentsService directly, same pattern VendorsController already
  // established for its own vendor-side project-dispute routes.
  @RequirePermissions('dispute:write')
  @Post('orders/:orderId/disputes')
  raiseOrderDispute(
    @Param('orderId') orderId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: RaiseOrderDisputeDto,
  ) {
    return this.payments.raiseOrderDispute(member.accountId, orderId, dto);
  }

  @RequirePermissions('dispute:read')
  @Get('orders/:orderId/disputes')
  findOrderDisputes(@Param('orderId') orderId: string, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.payments.findOrderDisputes(member.accountId, orderId);
  }

  @RequirePermissions('dispute:write')
  @Post('orders/:orderId/disputes/:disputeId/resolve')
  resolveOrderDispute(
    @Param('disputeId') disputeId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.payments.resolveOrderDispute(member.accountId, disputeId, dto);
  }

  // Same evidence methods a project dispute's own routes call —
  // requireDisputeParty (PaymentsService) branches on projectId/orderId
  // internally, so nothing dispute-type-specific is needed here.
  @RequirePermissions('dispute:write')
  @Post('orders/:orderId/disputes/:disputeId/evidence')
  submitOrderDisputeEvidence(
    @Param('disputeId') disputeId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @CurrentUser() user: UserCtx,
    @Body() dto: SubmitDisputeEvidenceDto,
  ) {
    return this.payments.submitDisputeEvidence(disputeId, member.accountId, user.id, dto);
  }

  @RequirePermissions('dispute:read')
  @Get('orders/:orderId/disputes/:disputeId/evidence')
  findOrderDisputeEvidence(@Param('disputeId') disputeId: string, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.payments.findDisputeEvidence(disputeId, member.accountId);
  }

  // Same proposal methods a project dispute's own routes call —
  // requireDisputeParty branches on projectId/orderId internally, so
  // nothing order-specific is needed here either.
  @RequirePermissions('dispute:write')
  @Post('orders/:orderId/disputes/:disputeId/proposals')
  proposeOrderDisputeResolution(
    @Param('disputeId') disputeId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: ProposeResolutionDto,
  ) {
    return this.payments.proposeResolution(disputeId, member.accountId, dto);
  }

  @RequirePermissions('dispute:read')
  @Get('orders/:orderId/disputes/:disputeId/proposals')
  findOrderDisputeResolutionProposals(@Param('disputeId') disputeId: string, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.payments.findResolutionProposals(disputeId, member.accountId);
  }

  @RequirePermissions('dispute:write')
  @Post('orders/:orderId/disputes/:disputeId/proposals/:proposalId/respond')
  respondToOrderDisputeResolutionProposal(
    @Param('disputeId') disputeId: string,
    @Param('proposalId') proposalId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: RespondToResolutionProposalDto,
  ) {
    return this.payments.respondToResolutionProposal(disputeId, proposalId, member.accountId, dto);
  }

  // Buyer-only, once their own order is delivered — see the gate in
  // MaterialsService.createOrderReview.
  @RequirePermissions('review:write')
  @Post('orders/:orderId/reviews')
  reviewOrder(
    @Param('orderId') orderId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: CreateOrderReviewDto,
  ) {
    return this.materials.createOrderReview(orderId, member.accountId, dto);
  }

  @RequirePermissions('review:write')
  @Patch('orders/:orderId/reviews/:reviewId')
  updateOrderReview(
    @Param('orderId') orderId: string,
    @Param('reviewId') reviewId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: UpdateOrderReviewDto,
  ) {
    return this.materials.updateOrderReview(orderId, reviewId, member.accountId, dto);
  }

  @RequirePermissions('review:write')
  @Delete('orders/:orderId/reviews/:reviewId')
  deleteOrderReview(
    @Param('orderId') orderId: string,
    @Param('reviewId') reviewId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
  ) {
    return this.materials.deleteOrderReview(orderId, reviewId, member.accountId);
  }

  // The supplier's own reply — same reasoning as VendorsController's
  // me/reviews/:reviewId/reply.
  @RequirePermissions('review:respond')
  @Post('suppliers/me/reviews/:reviewId/reply')
  replyToOrderReview(
    @CurrentAccountMember() member: AccountMemberCtx,
    @Param('reviewId') reviewId: string,
    @Body() dto: ReplyToReviewDto,
  ) {
    return this.materials.replyToOrderReview(member.accountId, reviewId, dto);
  }

  // The report side — see MaterialsService.flagOrderReview, the
  // materials-marketplace counterpart to VendorsController.flagReview.
  @RequirePermissions('review:flag')
  @Post('suppliers/me/reviews/:reviewId/flag')
  flagOrderReview(
    @CurrentAccountMember() member: AccountMemberCtx,
    @Param('reviewId') reviewId: string,
    @Body() dto: FlagReviewDto,
  ) {
    return this.materials.flagOrderReview(member.accountId, reviewId, dto);
  }

  // Module 6's neutral-reviewer queue — the materials-marketplace
  // counterpart to VendorsController.findFlaggedReviews/moderateReview.
  @RequirePermissions('review:moderate')
  @Get('suppliers/reviews/flagged')
  findFlaggedOrderReviews() {
    return this.materials.findFlaggedOrderReviews();
  }

  @RequirePermissions('review:moderate')
  @Patch('suppliers/reviews/:reviewId/moderate')
  moderateOrderReview(@Param('reviewId') reviewId: string, @Body() dto: ModerateReviewDto) {
    return this.materials.moderateOrderReview(reviewId, dto);
  }
}
