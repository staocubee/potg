import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
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
import { RequestBulkQuoteDto } from './dto/request-bulk-quote.dto';
import { RespondBulkQuoteDto } from './dto/respond-bulk-quote.dto';
import { UpsertCartItemDto } from './dto/upsert-cart-item.dto';
import { CheckoutCartDto } from './dto/checkout-cart.dto';
import { getSupplierTrustScore } from './trust-score';
import { rankingBoost } from '../common/search-ranking.util';
import { getActiveBoostMap, applyVisibilityBoost } from '../packages/boost.util';
import { InAppNotificationsService } from '../notifications/in-app-notifications.service';
import { PaystackService } from '../payments/paystack.service';
import { FlutterwaveService } from '../payments/flutterwave.service';
import { PaypalService } from '../payments/paypal.service';
import { StripeService } from '../payments/stripe.service';

// The same generic dispatch shape PaymentsService's own DepositGateway
// uses — Flutterwave/Stripe both take the shared params, PayPal doesn't
// carry email/metadata (see the PayPal branch in the constructor below),
// Paystack keeps its own separate branch in payOrder for the same reason
// PaymentsService.deposit does: real amount comparisons against its
// minor-unit (kobo) convention need their own path.
interface OrderPaymentGateway {
  initializeTransaction(params: {
    email: string;
    amount: number;
    currency: string;
    reference: string;
    callbackUrl: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ authorizationUrl: string; reference: string }>;
  verifyTransaction(reference: string): Promise<{ status: string; amount: number; currency: string }>;
}

// Same real constraint PaymentsService.payableEmail's own comment
// documents — Paystack's server-side validation rejects RFC
// 2606/6761-reserved test TLDs (.test/.example/.invalid/.localhost)
// outright, and this seed data's own demo accounts use exactly one of
// those. Duplicated here rather than exported and shared, the same
// "small pure function, not a cross-module import" convention this
// codebase already follows elsewhere.
const RESERVED_TEST_TLDS = ['test', 'example', 'invalid', 'localhost'];
function payableEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const tld = domain.split('.').pop();
  if (tld && RESERVED_TEST_TLDS.includes(tld.toLowerCase())) {
    return `${local}@${domain.slice(0, -tld.length)}com`;
  }
  return email;
}

@Injectable()
export class MaterialsService {
  private readonly orderPaymentGateways: Record<string, OrderPaymentGateway>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: InAppNotificationsService,
    private readonly paystack: PaystackService,
    private readonly flutterwave: FlutterwaveService,
    private readonly paypal: PaypalService,
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
  ) {
    this.orderPaymentGateways = {
      flutterwave: this.flutterwave,
      stripe: this.stripe,
      paypal: {
        initializeTransaction: (params) => this.paypal.initializeTransaction(params),
        verifyTransaction: (reference) => this.paypal.verifyTransaction(reference),
      },
    };
  }

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

  // Visibility-package boost — see ListingsService.findAll's own comment;
  // this list has no search mode of its own, so it's always the
  // unconditional browse-path reorder, no separate relevance-preserving
  // branch needed.
  async findSuppliers(category?: string) {
    const suppliers = await this.prisma.supplier.findMany({
      where: category ? { category } : undefined,
      orderBy: [{ ratingAverage: 'desc' }, { createdAt: 'desc' }],
    });
    const boostMap = await getActiveBoostMap(this.prisma);
    return applyVisibilityBoost(suppliers, boostMap);
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
    return this.prisma.supplier.update({
      where: { id: supplierId },
      data: { verificationStatus: dto.status, verificationNotes: dto.notes ?? null },
    });
  }

  // The structured "submit more evidence" channel supplier verification
  // was missing — the materials-marketplace counterpart to
  // VendorsService.submitVerificationEvidence, same reasoning.
  async submitVerificationEvidence(accountId: string, userId: string, dto: SubmitSupplierVerificationEvidenceDto) {
    const supplier = await this.prisma.supplier.findUnique({ where: { accountId } });
    if (!supplier) throw new NotFoundException('Supplier profile not found');
    if (supplier.verificationStatus === 'verified') {
      throw new BadRequestException('This supplier is already verified — nothing more to submit');
    }
    return this.prisma.supplierVerificationEvidence.create({
      data: { supplierId: supplier.id, submittedByUserId: userId, note: dto.note, fileUrl: dto.fileUrl },
    });
  }

  findMyVerificationEvidence(accountId: string) {
    return this.prisma.supplier.findUnique({ where: { accountId } }).verificationEvidence({ orderBy: { createdAt: 'asc' } });
  }

  findVerificationEvidence(supplierId: string) {
    return this.prisma.supplierVerificationEvidence.findMany({ where: { supplierId }, orderBy: { createdAt: 'asc' } });
  }

  // The real audit step — see VendorTrustAudit's schema comment (its
  // supplier-side counterpart, SupplierTrustAudit, follows the same
  // reasoning). Same supplier:verify gate as verification itself.
  async submitTrustAudit(supplierId: string, reviewedByUserId: string, dto: SubmitSupplierTrustAuditDto) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return this.prisma.supplierTrustAudit.create({
      data: { supplierId, reviewedByUserId, rating: dto.rating, notes: dto.notes },
    });
  }

  findTrustAudits(supplierId: string) {
    return this.prisma.supplierTrustAudit.findMany({ where: { supplierId }, orderBy: { createdAt: 'desc' } });
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

  // `q` closes "no free-text search in any marketplace" for the
  // materials catalog — same pg_trgm-backed "$queryRaw for matching ids,
  // Prisma findMany to hydrate, re-sort in JS" split
  // ListingsService.findAll's own comment explains in full.
  async findProducts(category?: string, supplierId?: string, q?: string) {
    let relevanceOrder: string[] | undefined;
    let relevanceScore: Map<string, number> | undefined;
    if (q) {
      // word_similarity() against an explicit 0.3 threshold — see
      // ListingsService.findAll's comment for why this, and specifically
      // why not the `<%` operator (its default threshold GUC is a
      // stricter 0.6, not the 0.3 plain similarity/`%` uses — this is the
      // exact query where that gap was caught: "Cermic Tile" scored 0.48
      // against "Ceramic Floor Tile (60x60)", passing 0.3 but failing 0.6).
      const matches = await this.prisma.$queryRaw<{ id: string; score: number }[]>`
        SELECT id, GREATEST(word_similarity(${q}, name), word_similarity(${q}, COALESCE(description, ''))) as score
        FROM products
        WHERE status = 'active' AND (word_similarity(${q}, name) > 0.3 OR word_similarity(${q}, COALESCE(description, '')) > 0.3)
        ORDER BY score DESC
        LIMIT 50
      `;
      relevanceOrder = matches.map((m) => m.id);
      relevanceScore = new Map(matches.map((m) => [m.id, Number(m.score)]));
      if (relevanceOrder.length === 0) return [];
    }

    const products = await this.prisma.product.findMany({
      where: { status: 'active', category, supplierId, id: relevanceOrder ? { in: relevanceOrder } : undefined },
      include: { supplier: { select: { id: true, businessName: true, ratingAverage: true, verificationStatus: true } } },
      orderBy: relevanceOrder ? undefined : { createdAt: 'desc' },
    });

    if (!relevanceOrder || !relevanceScore) return products;
    // See ListingsService.findAll's own comment on rankingBoost — text
    // relevance stays dominant, this only breaks near-ties. Rating and
    // verification come from the product's own supplier (a Product has
    // neither field itself), recency from the product's own createdAt.
    const scored = products.map((product) => ({
      product,
      finalScore:
        (relevanceScore!.get(product.id) ?? 0) +
        rankingBoost({
          createdAt: product.createdAt,
          ratingAverage: product.supplier.ratingAverage ? Number(product.supplier.ratingAverage) : null,
          isVerified: product.supplier.verificationStatus === 'verified',
        }),
    }));
    return scored.sort((a, b) => b.finalScore - a.finalScore).map((s) => s.product);
  }

  findProduct(id: string) {
    return this.prisma.product.findUnique({ where: { id }, include: { supplier: true } });
  }

  // The audit's own finding on Workflow 6: "No compare-suppliers UI or
  // endpoint — the product grid shows one supplier per card, no
  // side-by-side view." Each product's own supplier gets the same real
  // computed trustScore GET /suppliers/:id already returns (via
  // getSupplierTrustScore) rather than just the raw ratingAverage/
  // verificationStatus the grid card already shows — the whole point of
  // a comparison is seeing something the single-card view doesn't.
  async compareProducts(ids: string[]) {
    if (ids.length === 0) return [];
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      include: { supplier: true },
    });
    // Re-sorted back into the order the caller asked for — `id IN (...)`
    // doesn't preserve it, same reasoning ListingsService.findAll's own
    // relevance-order re-sort already documents.
    const byId = new Map(products.map((p) => [p.id, p]));
    const ordered = ids.map((id) => byId.get(id)).filter((p): p is (typeof products)[number] => !!p);
    return Promise.all(
      ordered.map(async (product) => ({
        ...product,
        supplier: { ...product.supplier, trustScore: await getSupplierTrustScore(this.prisma, product.supplier) },
      })),
    );
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
    // Security/integrity fix: an unvalidated projectId let a buyer tag an
    // order onto any account's project, silently inflating that other
    // project's own materialsSpent total (ProjectsService.getSpend) — no
    // cross-account read/write of the project itself, but a real data-
    // integrity gap since nothing previously confirmed the project named
    // actually belongs to the ordering account.
    if (dto.projectId) {
      const project = await this.prisma.project.findUnique({ where: { id: dto.projectId }, select: { accountId: true } });
      if (!project || project.accountId !== accountId) {
        throw new BadRequestException('That project does not belong to this account');
      }
    }

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

  // --- Bulk quote requests (Module 10) ------------------------------------
  //
  // The audit's own finding on Workflow 6: "Places an order or requests a
  // bulk quote — Placing an order is real. Bulk-quote/RFQ doesn't exist
  // for suppliers — VendorQuote is renovation-only." Buyer-initiated,
  // mirroring createRentalBooking's own reasoning: deliberately not
  // scoped through :propertyId/:projectId ABAC, since the buyer's
  // account doesn't own the supplier or the product.

  async requestBulkQuote(accountId: string, productId: string, dto: RequestBulkQuoteDto) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    // Same fix as createOrder above — acceptBulkQuote later copies this
    // same projectId onto a real Order unchanged, so checking it here
    // covers both.
    if (dto.projectId) {
      const project = await this.prisma.project.findUnique({ where: { id: dto.projectId }, select: { accountId: true } });
      if (!project || project.accountId !== accountId) {
        throw new BadRequestException('That project does not belong to this account');
      }
    }
    return this.prisma.bulkQuoteRequest.create({
      data: {
        accountId,
        supplierId: product.supplierId,
        productId,
        projectId: dto.projectId,
        quantity: dto.quantity,
        notes: dto.notes,
      },
    });
  }

  myBulkQuoteRequests(accountId: string) {
    return this.prisma.bulkQuoteRequest.findMany({
      where: { accountId },
      include: { product: { select: { id: true, name: true, unit: true, currency: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findSupplierBulkQuoteRequests(accountId: string) {
    const supplier = await this.requireOwnSupplier(accountId);
    return this.prisma.bulkQuoteRequest.findMany({
      where: { supplierId: supplier.id },
      include: { product: { select: { id: true, name: true, unit: true, currency: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Supplier-only: setting a real negotiated price is the "quote" itself —
  // same "the other party approves/responds" shape RentalBooking's own
  // confirm step uses, just with a real price attached rather than a bare
  // status flip.
  async respondToBulkQuote(accountId: string, requestId: string, dto: RespondBulkQuoteDto) {
    const supplier = await this.requireOwnSupplier(accountId);
    const bulkRequest = await this.prisma.bulkQuoteRequest.findFirst({ where: { id: requestId, supplierId: supplier.id } });
    if (!bulkRequest) throw new NotFoundException('Bulk quote request not found');
    if (bulkRequest.status !== 'requested') {
      throw new BadRequestException(`This request is already "${bulkRequest.status}"`);
    }
    return this.prisma.bulkQuoteRequest.update({
      where: { id: requestId },
      data: { status: 'quoted', quotedUnitPrice: dto.unitPrice, quotedNotes: dto.notes },
    });
  }

  // Buyer-only: converts a quoted request into a real Order at the
  // negotiated price, not the product's own current catalog unitPrice —
  // the entire reason this doesn't just reuse createOrder above. Not
  // wrapped in one $transaction with the stock decrement/status update,
  // same restraint createOrder's own comment already documents for this
  // codebase.
  async acceptBulkQuote(accountId: string, requestId: string) {
    const bulkRequest = await this.prisma.bulkQuoteRequest.findFirst({ where: { id: requestId, accountId } });
    if (!bulkRequest) throw new NotFoundException('Bulk quote request not found');
    if (bulkRequest.status !== 'quoted') {
      throw new BadRequestException(`This request is "${bulkRequest.status}" — no quote to accept`);
    }
    const product = await this.prisma.product.findUniqueOrThrow({ where: { id: bulkRequest.productId } });
    if (product.stockQuantity < bulkRequest.quantity) {
      throw new BadRequestException('Insufficient stock to fulfill this quote anymore');
    }
    const unitPrice = Number(bulkRequest.quotedUnitPrice);
    const lineTotal = unitPrice * bulkRequest.quantity;

    const order = await this.prisma.order.create({
      data: {
        accountId,
        supplierId: bulkRequest.supplierId,
        projectId: bulkRequest.projectId,
        totalAmount: lineTotal,
        currency: product.currency,
        items: { create: [{ productId: product.id, quantity: bulkRequest.quantity, unitPrice, lineTotal }] },
      },
      include: { items: true },
    });
    await this.prisma.product.update({ where: { id: product.id }, data: { stockQuantity: { decrement: bulkRequest.quantity } } });
    await this.prisma.bulkQuoteRequest.update({ where: { id: requestId }, data: { status: 'accepted' } });
    return order;
  }

  async declineBulkQuote(accountId: string, requestId: string) {
    const bulkRequest = await this.prisma.bulkQuoteRequest.findFirst({ where: { id: requestId, accountId } });
    if (!bulkRequest) throw new NotFoundException('Bulk quote request not found');
    if (bulkRequest.status !== 'quoted') {
      throw new BadRequestException(`This request is "${bulkRequest.status}" — nothing to decline`);
    }
    return this.prisma.bulkQuoteRequest.update({ where: { id: requestId }, data: { status: 'declined' } });
  }

  findOrdersForBuyer(accountId: string) {
    return this.prisma.order.findMany({
      where: { accountId },
      // The Property Owner Dashboard's own "Pending approvals" card names
      // each pending order by its real supplier — this endpoint never
      // included one before, so every row silently fell back to a generic
      // label. Same select shape findFlaggedOrderReviews already uses.
      include: { items: true, delivery: true, supplier: { select: { id: true, businessName: true } } },
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
      include: { items: { include: { product: true } }, delivery: true, supplier: true, review: true, payment: true },
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

  // The audit's own finding on Workflow 6: "Order/Payment are entirely
  // disconnected... no spend-approval routing mechanism at all." A
  // supplier can't move an order past "pending" until the buyer's own
  // spend authority approves it — mirrors PropertiesService.
  // startMaintenanceRequest's own approvalStatus !== 'approved' guard.
  // Only the pending -> confirmed transition is gated: shipped/delivered/
  // cancelled only make sense once an order is already confirmed (or
  // cancelling a still-unapproved one, which needs no permission this
  // pass doesn't already require).
  async updateOrderStatus(orderId: string, accountId: string, dto: UpdateOrderStatusDto) {
    const supplier = await this.requireOwnSupplier(accountId);
    const order = await this.prisma.order.findFirst({ where: { id: orderId, supplierId: supplier.id } });
    if (!order) throw new NotFoundException('Order not found in your supplier account');
    if (dto.status === 'confirmed' && order.approvalStatus !== 'approved') {
      throw new BadRequestException('This order must be approved by the buyer before it can be confirmed');
    }
    return this.prisma.order.update({ where: { id: orderId }, data: { status: dto.status } });
  }

  // The buyer's own side of the gate above — payment:approve, the same
  // permission that already authorizes releasing a project's own escrow
  // funds (PaymentsService.releaseMilestone), reused rather than a new
  // permission: both are "does this account's own spend authority sign
  // off on this," just for a materials order instead of a milestone.
  // Only while "pending" — once a supplier has acted on it, a late
  // approval/rejection wouldn't mean anything real anymore.
  async setOrderApproval(orderId: string, accountId: string, dto: SetOrderApprovalDto) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, accountId } });
    if (!order) throw new NotFoundException('Order not found in your account');
    if (order.status !== 'pending') {
      throw new BadRequestException(`This order is already "${order.status}" — approval only applies before the supplier acts on it`);
    }
    return this.prisma.order.update({
      where: { id: orderId },
      data: { approvalStatus: dto.status, approvalNotes: dto.notes },
    });
  }

  // The other half of the audit's own finding on Order.approvalStatus
  // above: "no gateway call, no charge on order creation." Deliberately
  // independent of approvalStatus — a buyer can pay whenever it wants to,
  // same as a project deposit never required a milestone to be approved
  // first; approval only ever gated the supplier's own pending->confirmed
  // move, a different concern. "manual" (no provider given) completes
  // instantly, same simulated-payment convention Payment.provider's own
  // schema comment documents; a real gateway creates a pending
  // OrderPayment and returns a real hosted-checkout URL, credited only
  // once verifyOrderPayment confirms the charge actually succeeded — an
  // abandoned checkout tab never phantom-pays the supplier.
  async payOrder(orderId: string, accountId: string, email: string, provider?: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, accountId } });
    if (!order) throw new NotFoundException('Order not found in your account');
    const existing = await this.prisma.orderPayment.findUnique({ where: { orderId } });
    if (existing && existing.status !== 'failed') {
      throw new BadRequestException(`This order already has a payment (status: "${existing.status}")`);
    }

    const amount = Number(order.totalAmount);
    const currency = order.currency;

    if (provider === 'paystack') {
      const reference = `potg_ord_${randomUUID()}`;
      const webAppUrl = this.config.get<string>('WEB_APP_URL', 'http://localhost:3000');
      const { authorizationUrl } = await this.paystack.initializeTransaction({
        email: payableEmail(email),
        amount,
        currency,
        reference,
        callbackUrl: `${webAppUrl}/marketplace/materials/orders/${orderId}?paymentReference=${reference}`,
        metadata: { orderId, accountId },
      });
      const payment = await this.upsertOrderPayment(orderId, accountId, {
        amount, currency, provider: 'paystack', providerReference: reference, status: 'pending',
      });
      return { payment, authorizationUrl };
    }

    const gateway = provider ? this.orderPaymentGateways[provider] : undefined;
    if (gateway) {
      const reference = `potg_ord_${randomUUID()}`;
      const webAppUrl = this.config.get<string>('WEB_APP_URL', 'http://localhost:3000');
      const init = await gateway.initializeTransaction({
        email: payableEmail(email),
        amount,
        currency,
        reference,
        callbackUrl: `${webAppUrl}/marketplace/materials/orders/${orderId}?paymentReference=${reference}`,
        metadata: { orderId, accountId },
      });
      const payment = await this.upsertOrderPayment(orderId, accountId, {
        amount, currency, provider: provider!, providerReference: init.reference, status: 'pending',
      });
      return { payment, authorizationUrl: init.authorizationUrl };
    }

    const payment = await this.upsertOrderPayment(orderId, accountId, {
      amount, currency, provider: 'manual', providerReference: undefined, status: 'completed',
    });
    return { payment };
  }

  private upsertOrderPayment(
    orderId: string,
    accountId: string,
    data: { amount: number; currency: string; provider: string; providerReference?: string; status: string },
  ) {
    return this.prisma.orderPayment.upsert({
      where: { orderId },
      update: data,
      create: { orderId, accountId, ...data },
    });
  }

  // The other half of the real gateway path — asks the gateway directly
  // whether the charge actually succeeded, same real verify-not-trust
  // shape PaymentsService.verifyDeposit already uses for project
  // deposits. Callable more than once safely: an already-"completed"
  // payment just returns itself.
  async verifyOrderPayment(orderId: string, accountId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, accountId } });
    if (!order) throw new NotFoundException('Order not found in your account');
    const payment = await this.prisma.orderPayment.findUnique({ where: { orderId } });
    if (!payment) throw new NotFoundException('This order has no payment to verify');

    if (payment.status === 'completed') {
      return { payment, alreadyVerified: true };
    }
    if (payment.status !== 'pending' || !payment.providerReference) {
      throw new BadRequestException(`This payment is "${payment.status}" — nothing to verify`);
    }

    const result =
      payment.provider === 'paystack'
        ? await this.verifyPaystackOrderPayment(payment.providerReference)
        : await this.orderPaymentGateways[payment.provider]?.verifyTransaction(payment.providerReference);
    if (!result) throw new BadRequestException('Only a real-gateway payment needs verification');

    if (result.status === 'failed') {
      const updated = await this.prisma.orderPayment.update({ where: { id: payment.id }, data: { status: 'failed' } });
      return { payment: updated, alreadyVerified: false };
    }
    if (result.status !== 'success') {
      return { payment, alreadyVerified: false };
    }

    const expectedAmount = Number(payment.amount);
    if (Math.abs(result.amount - expectedAmount) > 0.01 || result.currency !== payment.currency) {
      throw new BadRequestException(
        `${payment.provider} confirmed a different amount/currency than expected (got ${result.amount} ${result.currency})`,
      );
    }

    const completed = await this.prisma.orderPayment.update({ where: { id: payment.id }, data: { status: 'completed' } });
    return { payment: completed, alreadyVerified: false };
  }

  // Paystack's own real amount unit is kobo (minor units) — see
  // PaymentsService.verifyDeposit's own Paystack branch for why this
  // can't share OrderPaymentGateway's major-unit verifyTransaction shape.
  private async verifyPaystackOrderPayment(reference: string): Promise<{ status: string; amount: number; currency: string }> {
    const result = await this.paystack.verifyTransaction(reference);
    return { status: result.status, amount: result.amountKobo / 100, currency: result.currency };
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

  // The audit's own finding: only a supplier can ever set delivery
  // status, including "delivered" — the buyer had no confirm-receipt
  // action of its own. Deliberately a separate field (Delivery.
  // confirmedAt) rather than reusing deliveredAt, so "the supplier says
  // it shipped/arrived" and "the site says it actually has it" stay two
  // distinct, independently-true facts instead of one party being able
  // to silently claim the other's half.
  async confirmReceipt(orderId: string, accountId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, accountId }, include: { delivery: true } });
    if (!order) throw new NotFoundException('Order not found in your account');
    if (!order.delivery || order.delivery.status !== 'delivered') {
      throw new BadRequestException('This order has not been marked delivered by the supplier yet');
    }
    if (order.delivery.confirmedAt) {
      throw new BadRequestException('Receipt was already confirmed for this order');
    }

    const delivery = await this.prisma.delivery.update({ where: { orderId }, data: { confirmedAt: new Date() } });

    const supplier = await this.prisma.supplier.findUnique({ where: { id: order.supplierId } });
    if (supplier) {
      this.notifications.notify(
        supplier.accountId,
        'order_receipt_confirmed',
        `Receipt confirmed for order`,
        `The buyer confirmed they received order #${order.id.slice(0, 8)}.`,
        `/marketplace/materials/orders/${order.id}`,
      );
    }

    return delivery;
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
