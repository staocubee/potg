import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember } from '../common/decorators/current-user.decorator';
import { MaterialsService } from './materials.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateDeliveryDto } from './dto/update-delivery.dto';
import { CreateOrderReviewDto } from './dto/create-order-review.dto';
import { UpdateOrderReviewDto } from './dto/update-order-review.dto';
import { ReplyToReviewDto } from '../vendors/dto/reply-to-review.dto';

type AccountMemberCtx = { accountId: string };

// No :propertyId/:projectId route params here either (orders carry an
// optional projectId in the body, not the URL) — every ownership check in
// this module happens in MaterialsService, same reasoning as
// ListingsController.
@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller()
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

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

  // Public catalog browse/search across suppliers.
  @RequirePermissions('product:read')
  @Get('products')
  findProducts(@Query('category') category?: string, @Query('supplierId') supplierId?: string) {
    return this.materials.findProducts(category, supplierId);
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

  @RequirePermissions('order:write')
  @Patch('orders/:orderId/delivery')
  upsertDelivery(
    @Param('orderId') orderId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: UpdateDeliveryDto,
  ) {
    return this.materials.upsertDelivery(orderId, member.accountId, dto);
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
}
