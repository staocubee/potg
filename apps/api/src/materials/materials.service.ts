import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateDeliveryDto } from './dto/update-delivery.dto';
import { CreateOrderReviewDto } from './dto/create-order-review.dto';
import { UpdateOrderReviewDto } from './dto/update-order-review.dto';
import { ReplyToReviewDto } from '../vendors/dto/reply-to-review.dto';
import { FlagReviewDto } from '../vendors/dto/flag-review.dto';
import { ModerateReviewDto } from '../vendors/dto/moderate-review.dto';
import { SetSupplierVerificationDto } from './dto/set-supplier-verification.dto';
import { CreateRentalBookingDto } from './dto/create-rental-booking.dto';
import { UpsertCartItemDto } from './dto/upsert-cart-item.dto';
import { CheckoutCartDto } from './dto/checkout-cart.dto';
import { getSupplierTrustScore } from './trust-score';

@Injectable()
export class MaterialsService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireOwnSupplier(accountId: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { accountId } });
    if (!supplier) {
      throw new BadRequestException('This account has no supplier profile yet — create one with POST /suppliers first');
    }
    return supplier;
  }

  // --- Suppliers -----------------------------------------------------

  async createSupplier(accountId: string, dto: CreateSupplierDto) {
    const existing = await this.prisma.supplier.findUnique({ where: { accountId } });
    if (existing) {
      throw new ConflictException('This account already has a supplier profile — use PATCH to update it');
    }
    return this.prisma.supplier.create({ data: { accountId, ...dto } });
  }

  findSuppliers(category?: string) {
    return this.prisma.supplier.findMany({
      where: category ? { category } : undefined,
      orderBy: [{ ratingAverage: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findMySupplier(accountId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { accountId },
      include: { products: true, reviews: { orderBy: { createdAt: 'desc' } } },
    });
    if (!supplier) return supplier;
    return { ...supplier, trustScore: await getSupplierTrustScore(this.prisma, supplier) };
  }

  // Public marketplace view — hides a review moderateOrderReview has
  // marked "hidden" (findMySupplier, the supplier's own view, shows every
  // review including hidden ones so it can see why one disappeared
  // publicly).
  async findSupplier(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        products: { where: { status: 'active' } },
        reviews: { where: { moderationStatus: { not: 'hidden' } }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!supplier) return supplier;
    return { ...supplier, trustScore: await getSupplierTrustScore(this.prisma, supplier) };
  }

  // Module 6's actual neutral-reviewer action, the materials-marketplace
  // counterpart to VendorsService.setVerificationStatus — gated on
  // supplier:verify, which only the platform_reviewer role carries, never
  // the supplier role itself.
  async setSupplierVerificationStatus(supplierId: string, dto: SetSupplierVerificationDto) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return this.prisma.supplier.update({ where: { id: supplierId }, data: { verificationStatus: dto.status } });
  }

  // --- Products --------------------------------------------------------

  async createProduct(accountId: string, dto: CreateProductDto) {
    const supplier = await this.requireOwnSupplier(accountId);
    return this.prisma.product.create({
      data: {
        supplierId: supplier.id,
        name: dto.name,
        category: dto.category,
        unit: dto.unit,
        unitPrice: dto.unitPrice,
        currency: dto.currency ?? 'USD',
        stockQuantity: dto.stockQuantity ?? 0,
        description: dto.description,
        isRentable: dto.isRentable ?? false,
        rentalPricePerDay: dto.rentalPricePerDay,
      },
    });
  }

  async updateProduct(accountId: string, productId: string, dto: UpdateProductDto) {
    const supplier = await this.requireOwnSupplier(accountId);
    const product = await this.prisma.product.findFirst({ where: { id: productId, supplierId: supplier.id } });
    if (!product) throw new NotFoundException('Product not found in your catalog');
    return this.prisma.product.update({ where: { id: productId }, data: dto });
  }

  findProducts(category?: string, supplierId?: string) {
    return this.prisma.product.findMany({
      where: { status: 'active', category, supplierId },
      include: { supplier: { select: { id: true, businessName: true, ratingAverage: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  findProduct(id: string) {
    return this.prisma.product.findUnique({ where: { id }, include: { supplier: true } });
  }

  // --- Rental bookings (Module 10) ---------------------------------------
  //
  // A booking's availability is checked against the sum of quantity on
  // requested/confirmed bookings whose date range overlaps the new
  // request (standard "startA < endB && endA > startB" interval overlap)
  // — there's no separate rental-only stock count, a product's
  // stockQuantity is shared between sale and rental.

  async createRentalBooking(accountId: string, productId: string, dto: CreateRentalBookingDto) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    if (!product.isRentable) throw new BadRequestException('This product is not available for rental');

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate <= startDate) throw new BadRequestException('endDate must be after startDate');
    const quantity = dto.quantity ?? 1;

    const overlapping = await this.prisma.rentalBooking.aggregate({
      where: {
        productId,
        status: { in: ['requested', 'confirmed'] },
        startDate: { lt: endDate },
        endDate: { gt: startDate },
      },
      _sum: { quantity: true },
    });
    const alreadyBooked = overlapping._sum.quantity ?? 0;
    if (alreadyBooked + quantity > product.stockQuantity) {
      throw new BadRequestException(
        `Only ${Math.max(product.stockQuantity - alreadyBooked, 0)} unit(s) of this product are available for those dates`,
      );
    }

    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const totalPrice = Number(product.rentalPricePerDay ?? 0) * days * quantity;

    return this.prisma.rentalBooking.create({
      data: {
        productId,
        accountId,
        quantity,
        startDate,
        endDate,
        totalPrice,
        currency: product.currency,
        notes: dto.notes,
      },
    });
  }

  findMyRentalBookings(accountId: string) {
    return this.prisma.rentalBooking.findMany({
      where: { accountId },
      include: { product: { select: { id: true, name: true, supplierId: true } } },
      orderBy: { startDate: 'desc' },
    });
  }

  async findSupplierRentalBookings(accountId: string) {
    const supplier = await this.requireOwnSupplier(accountId);
    return this.prisma.rentalBooking.findMany({
      where: { product: { supplierId: supplier.id } },
      include: { product: { select: { id: true, name: true } } },
      orderBy: { startDate: 'desc' },
    });
  }

  // Supplier-only: confirming is the supplier accepting the request, same
  // "the other party approves" shape VendorQuote's accept step uses.
  async confirmRentalBooking(accountId: string, bookingId: string) {
    const supplier = await this.requireOwnSupplier(accountId);
    const booking = await this.prisma.rentalBooking.findFirst({
      where: { id: bookingId, product: { supplierId: supplier.id } },
    });
    if (!booking) throw new NotFoundException('Rental booking not found');
    if (booking.status !== 'requested') {
      throw new BadRequestException(`This booking is already "${booking.status}"`);
    }
    return this.prisma.rentalBooking.update({ where: { id: bookingId }, data: { status: 'confirmed' } });
  }

  async returnRentalBooking(accountId: string, bookingId: string) {
    const supplier = await this.requireOwnSupplier(accountId);
    const booking = await this.prisma.rentalBooking.findFirst({
      where: { id: bookingId, product: { supplierId: supplier.id } },
    });
    if (!booking) throw new NotFoundException('Rental booking not found');
    if (booking.status !== 'confirmed') {
      throw new BadRequestException(`This booking is "${booking.status}" — only a confirmed booking can be marked returned`);
    }
    return this.prisma.rentalBooking.update({
      where: { id: bookingId },
      data: { status: 'returned', returnedAt: new Date() },
    });
  }

  // Either side can cancel while it's still requested/confirmed — the
  // renter changing their mind, or the supplier being unable to fulfil it.
  async cancelRentalBooking(accountId: string, bookingId: string) {
    const booking = await this.prisma.rentalBooking.findUnique({
      where: { id: bookingId },
      include: { product: true },
    });
    if (!booking) throw new NotFoundException('Rental booking not found');
    const supplier = await this.prisma.supplier.findUnique({ where: { accountId } });
    const isRenter = booking.accountId === accountId;
    const isSupplier = supplier?.id === booking.product.supplierId;
    if (!isRenter && !isSupplier) throw new NotFoundException('Rental booking not found');
    if (booking.status !== 'requested' && booking.status !== 'confirmed') {
      throw new BadRequestException(`This booking is already "${booking.status}"`);
    }
    return this.prisma.rentalBooking.update({ where: { id: bookingId }, data: { status: 'cancelled' } });
  }

  // --- Cart (server-side) -------------------------------------------------
  //
  // Doesn't replace the supplier detail page's own localStorage cart — that
  // stays the pre-account-decision scratch space while browsing. This is
  // what CheckoutCart reads once the buyer is ready to place a real order,
  // and (unlike localStorage) follows the account across devices.

  getCart(accountId: string) {
    return this.prisma.cartItem.findMany({
      where: { accountId },
      include: { product: { include: { supplier: { select: { id: true, businessName: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async upsertCartItem(accountId: string, dto: UpsertCartItemDto) {
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('Product not found');

    if (dto.quantity <= 0) {
      await this.prisma.cartItem.deleteMany({ where: { accountId, productId: dto.productId } });
      return { removed: true };
    }
    return this.prisma.cartItem.upsert({
      where: { accountId_productId: { accountId, productId: dto.productId } },
      update: { quantity: dto.quantity },
      create: { accountId, productId: dto.productId, quantity: dto.quantity },
    });
  }

  async removeCartItem(accountId: string, productId: string) {
    await this.prisma.cartItem.deleteMany({ where: { accountId, productId } });
    return { removed: true };
  }

  // Converts every cart item for one supplier into a real Order via the
  // exact same createOrder path a direct checkout uses (never duplicates
  // its stock/price logic), then clears just those items — cart items for
  // other suppliers are untouched, matching how the order itself is always
  // per-supplier.
  async checkoutCart(accountId: string, dto: CheckoutCartDto) {
    const items = await this.prisma.cartItem.findMany({
      where: { accountId, product: { supplierId: dto.supplierId } },
    });
    if (items.length === 0) {
      throw new BadRequestException('Your cart has no items from this supplier');
    }
    const order = await this.createOrder(accountId, {
      supplierId: dto.supplierId,
      projectId: dto.projectId,
      deliveryAddress: dto.deliveryAddress,
      items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    });
    await this.prisma.cartItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
    return order;
  }

  // --- Orders ------------------------------------------------------------

  async createOrder(accountId: string, dto: CreateOrderDto) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplierId } });
    if (!supplier) throw new NotFoundException('Supplier not found');

    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({ where: { id: { in: productIds }, supplierId: supplier.id } });
    if (products.length !== productIds.length) {
      throw new BadRequestException('One or more products were not found in this supplier’s catalog');
    }
    // `(typeof products)[number]` instead of a hand-written `{ id: string }`
    // annotation — that earlier shape silently narrowed what TypeScript
    // infers for the Map's *value* type too (inferred from `[p.id, p]` with
    // `p` typed by the annotation, not from `products`' real element type),
    // which is exactly what forced the unsafe cast below it used to need.
    // Deriving the annotation from `products` itself keeps it correct
    // whichever `@prisma/client` this compiles against — the real
    // generated `Product` type once `prisma generate` can run, or the
    // untyped stub here where `prisma generate` still can't (see README).
    const byId = new Map<string, (typeof products)[number]>(products.map((p: (typeof products)[number]) => [p.id, p]));

    let totalAmount = 0;
    const itemsData = dto.items.map((item) => {
      const product = byId.get(item.productId);
      // Already implied by the productIds.length check above (every
      // requested id was found), but TypeScript can't see that from here —
      // this keeps the lookup honestly typed instead of asserting past it.
      if (!product) {
        throw new BadRequestException(`Product ${item.productId} not found in this supplier's catalog`);
      }
      if (product.stockQuantity < item.quantity) {
        throw new BadRequestException(`Insufficient stock for product ${item.productId}`);
      }
      const unitPrice = Number(product.unitPrice);
      const lineTotal = unitPrice * item.quantity;
      totalAmount += lineTotal;
      return { productId: item.productId, quantity: item.quantity, unitPrice, lineTotal };
    });
    const currency = products[0].currency;

    const order = await this.prisma.order.create({
      data: {
        accountId,
        supplierId: supplier.id,
        projectId: dto.projectId,
        totalAmount,
        currency,
        deliveryAddress: dto.deliveryAddress,
        items: { create: itemsData },
      },
      include: { items: true },
    });

    // Decrement stock per item — not wrapped in the same $transaction as the
    // order create above because Prisma's nested `create` already ran; a
    // stricter implementation would use one $transaction for all of it.
    await Promise.all(
      itemsData.map((item) =>
        this.prisma.product.update({
          where: { id: item.productId },
          data: { stockQuantity: { decrement: item.quantity } },
        }),
      ),
    );

    return order;
  }

  findOrdersForBuyer(accountId: string) {
    return this.prisma.order.findMany({
      where: { accountId },
      include: { items: true, delivery: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOrdersForSupplier(accountId: string) {
    const supplier = await this.requireOwnSupplier(accountId);
    return this.prisma.order.findMany({
      where: { supplierId: supplier.id },
      include: { items: true, delivery: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOrder(orderId: string, accountId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } }, delivery: true, supplier: true, review: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    const supplier = await this.prisma.supplier.findUnique({ where: { id: order.supplierId } });
    const isBuyer = order.accountId === accountId;
    const isSupplier = supplier?.accountId === accountId;
    if (!isBuyer && !isSupplier) {
      throw new ForbiddenException('This order belongs to a different account');
    }
    return order;
  }

  async updateOrderStatus(orderId: string, accountId: string, dto: UpdateOrderStatusDto) {
    const supplier = await this.requireOwnSupplier(accountId);
    const order = await this.prisma.order.findFirst({ where: { id: orderId, supplierId: supplier.id } });
    if (!order) throw new NotFoundException('Order not found in your supplier account');
    return this.prisma.order.update({ where: { id: orderId }, data: { status: dto.status } });
  }

  async upsertDelivery(orderId: string, accountId: string, dto: UpdateDeliveryDto) {
    const supplier = await this.requireOwnSupplier(accountId);
    const order = await this.prisma.order.findFirst({ where: { id: orderId, supplierId: supplier.id } });
    if (!order) throw new NotFoundException('Order not found in your supplier account');

    const data = {
      status: dto.status,
      trackingReference: dto.trackingReference,
      estimatedDeliveryDate: dto.estimatedDeliveryDate ? new Date(dto.estimatedDeliveryDate) : undefined,
      deliveredAt: dto.status === 'delivered' ? new Date() : undefined,
    };
    return this.prisma.delivery.upsert({
      where: { orderId },
      update: data,
      create: { orderId, ...data },
    });
  }

  // --- Reviews -------------------------------------------------------

  // The materials-marketplace counterpart to VendorsService.createReview —
  // gated on the *order* being delivered rather than a project being
  // completed, since an order doesn't always belong to a project at all
  // (Order.projectId is optional). One review per order
  // (SupplierReview.orderId is @unique).
  async createOrderReview(orderId: string, accountId: string, dto: CreateOrderReviewDto) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.accountId !== accountId) {
      throw new ForbiddenException('This order belongs to a different account');
    }
    if (order.status !== 'delivered') {
      throw new BadRequestException('Only a delivered order can be reviewed');
    }

    const existing = await this.prisma.supplierReview.findUnique({ where: { orderId } });
    if (existing) {
      throw new ConflictException('This order has already been reviewed');
    }

    const review = await this.prisma.supplierReview.create({
      data: { supplierId: order.supplierId, orderId, accountId, rating: dto.rating, comment: dto.comment },
    });
    await this.recomputeRating(order.supplierId);
    return review;
  }

  // Excludes "hidden" reviews (but not "flagged" ones — see
  // VendorsService.recomputeRating's counterpart for why) so a review a
  // moderator hides for spam/abuse stops inflating or deflating the
  // supplier's rating.
  private async recomputeRating(supplierId: string) {
    const { _avg } = await this.prisma.supplierReview.aggregate({
      where: { supplierId, moderationStatus: { not: 'hidden' } },
      _avg: { rating: true },
    });
    await this.prisma.supplier.update({
      where: { id: supplierId },
      data: { ratingAverage: _avg.rating ?? null },
    });
  }

  // Reviewer-side edit/delete — same "accountId on the review is the
  // source of truth" check as VendorsService's counterpart, since orders
  // (unlike projects) have no :orderId ABAC convention to lean on at all.
  async updateOrderReview(orderId: string, reviewId: string, accountId: string, dto: UpdateOrderReviewDto) {
    const review = await this.prisma.supplierReview.findFirst({ where: { id: reviewId, orderId } });
    if (!review) throw new NotFoundException('Review not found on this order');
    if (review.accountId !== accountId) {
      throw new ForbiddenException('Only the account that left this review can edit it');
    }
    const updated = await this.prisma.supplierReview.update({
      where: { id: reviewId },
      data: { rating: dto.rating ?? review.rating, comment: dto.comment !== undefined ? dto.comment : review.comment },
    });
    if (dto.rating !== undefined) await this.recomputeRating(review.supplierId);
    return updated;
  }

  async deleteOrderReview(orderId: string, reviewId: string, accountId: string) {
    const review = await this.prisma.supplierReview.findFirst({ where: { id: reviewId, orderId } });
    if (!review) throw new NotFoundException('Review not found on this order');
    if (review.accountId !== accountId) {
      throw new ForbiddenException('Only the account that left this review can delete it');
    }
    await this.prisma.supplierReview.delete({ where: { id: reviewId } });
    await this.recomputeRating(review.supplierId);
    return { deleted: true };
  }

  // The supplier's own reply — the materials-marketplace counterpart to
  // VendorsService.replyToReview, same one-reply-overwrites-the-last-one
  // shape.
  async replyToOrderReview(supplierAccountId: string, reviewId: string, dto: ReplyToReviewDto) {
    const supplier = await this.prisma.supplier.findUnique({ where: { accountId: supplierAccountId } });
    if (!supplier) throw new NotFoundException('Review not found');
    const review = await this.prisma.supplierReview.findUnique({ where: { id: reviewId } });
    if (!review || review.supplierId !== supplier.id) throw new NotFoundException('Review not found');
    return this.prisma.supplierReview.update({
      where: { id: reviewId },
      data: { response: dto.response, respondedAt: new Date() },
    });
  }

  // The materials-marketplace counterpart to VendorsService.flagReview —
  // same reasoning, same review:flag-gated ownership check.
  async flagOrderReview(supplierAccountId: string, reviewId: string, dto: FlagReviewDto) {
    const supplier = await this.prisma.supplier.findUnique({ where: { accountId: supplierAccountId } });
    if (!supplier) throw new NotFoundException('Review not found');
    const review = await this.prisma.supplierReview.findUnique({ where: { id: reviewId } });
    if (!review || review.supplierId !== supplier.id) throw new NotFoundException('Review not found');
    if (review.moderationStatus === 'hidden') {
      throw new BadRequestException('This review has already been hidden by a moderator');
    }
    return this.prisma.supplierReview.update({
      where: { id: reviewId },
      data: { moderationStatus: 'flagged', flagReason: dto.reason, flaggedAt: new Date() },
    });
  }

  // The materials-marketplace counterpart to VendorsService.findFlaggedReviews.
  findFlaggedOrderReviews() {
    return this.prisma.supplierReview.findMany({
      where: { moderationStatus: 'flagged' },
      include: { supplier: { select: { id: true, businessName: true } } },
      orderBy: { flaggedAt: 'desc' },
    });
  }

  // The materials-marketplace counterpart to VendorsService.moderateReview
  // — same "flagged or hidden, never published" reversibility shape.
  async moderateOrderReview(reviewId: string, dto: ModerateReviewDto) {
    const review = await this.prisma.supplierReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Review not found');
    if (review.moderationStatus === 'published') {
      throw new BadRequestException('This review has never been flagged — nothing to moderate');
    }
    const updated = await this.prisma.supplierReview.update({
      where: { id: reviewId },
      data: { moderationStatus: dto.status, moderationNotes: dto.moderationNotes, moderatedAt: new Date() },
    });
    if (dto.status === 'hidden' || review.moderationStatus === 'hidden') {
      await this.recomputeRating(review.supplierId);
    }
    return updated;
  }
}
