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

  async findSupplier(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        products: { where: { status: 'active' } },
        reviews: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!supplier) return supplier;
    return { ...supplier, trustScore: await getSupplierTrustScore(this.prisma, supplier) };
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

  private async recomputeRating(supplierId: string) {
    const { _avg } = await this.prisma.supplierReview.aggregate({ where: { supplierId }, _avg: { rating: true } });
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
}
