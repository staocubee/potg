import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { CreateInquiryDto } from './dto/create-inquiry.dto';
import { CreateOfferDto } from './dto/create-offer.dto';
import { RespondOfferDto } from './dto/respond-offer.dto';
import { RespondToCounterDto } from './dto/respond-to-counter.dto';
import { SearchListingsQuery } from './dto/search-listings.dto';
import { SetListingVerificationDto } from './dto/set-listing-verification.dto';
import { RequestInspectionDto } from './dto/request-inspection.dto';
import { rankingBoost } from '../common/search-ranking.util';
import { getActiveBoostMap, applyVisibilityBoost } from '../packages/boost.util';
import { InAppNotificationsService } from '../notifications/in-app-notifications.service';
import { DEFAULT_DOCUMENT_CHECKLIST, labelDocumentType } from '../ai/skills/document-checklists';

@Injectable()
export class ListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: InAppNotificationsService,
  ) {}

  private async requireOwnListing(listingId: string, accountId: string) {
    const listing = await this.prisma.propertyListing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.accountId !== accountId) {
      throw new ForbiddenException('This listing belongs to a different account');
    }
    return listing;
  }

  async create(accountId: string, dto: CreateListingDto) {
    const property = await this.prisma.property.findFirst({
      where: { id: dto.propertyId, accountId },
      include: { account: { select: { currency: true } } },
    });
    if (!property) throw new NotFoundException('Property not found');

    return this.prisma.propertyListing.create({
      data: {
        propertyId: dto.propertyId,
        accountId,
        listingType: dto.listingType,
        askingPrice: dto.askingPrice,
        currency: dto.currency ?? property.account.currency,
        title: dto.title,
        description: dto.description,
        photoUrls: dto.photoUrls ?? [],
      },
    });
  }

  // Public marketplace browse/search — no tenant isolation on purpose, and
  // "draft" listings never show up here (only the owner sees those, via
  // GET /listings/me).
  //
  // query.q (new) is the actual "search" half of this, closing the "no
  // free-text search in any marketplace" gap — every filter above it was
  // already exact-match. Uses Postgres's own pg_trgm extension (typo-
  // tolerant trigram similarity, see the migration enabling it) rather
  // than a real Elasticsearch/OpenSearch cluster: raw SQL picks the
  // matching ids and their relevance score first ($queryRaw, safely
  // parameterized by Prisma's own tagged-template — never string-
  // concatenated), then a normal Prisma findMany hydrates the full rows
  // (with their usual `include`) from just those ids, re-sorted back into
  // relevance order in JS since `id IN (...)` doesn't preserve it. Same
  // "raw SQL for the part Prisma's query builder can't express, Prisma
  // for everything else" split the vector-search feature below also uses.
  //
  // Uses the word_similarity() function against an explicit 0.3 threshold,
  // not plain similarity()/`%` and not the `<%` operator. Two things
  // verified live, the hard way: (1) plain similarity() scores the ENTIRE
  // strings against each other, so a short query loses even against an
  // exact substring match once the field is longer than the query
  // ("Ocean Drive" against a full title scored 0.29, below the 0.3
  // default threshold) — word_similarity() checks the query against the
  // best-matching substring instead, which is what "search" means here.
  // (2) the `<%` operator looked like the natural way to use it, but it's
  // gated by a SEPARATE, stricter GUC (pg_trgm.word_similarity_threshold,
  // default 0.6, vs 0.3 for plain `%`) — a real word_similarity() score of
  // 0.48 ("Cermic Tile" vs "Ceramic Floor Tile (60x60)" on the materials
  // search this same pass) passed the function but failed the operator.
  // Calling word_similarity() directly and comparing to 0.3 by hand keeps
  // one consistent, GUC-independent threshold across all three searches.
  async findAll(query: SearchListingsQuery) {
    const minPrice = query.minPrice ? Number(query.minPrice) : undefined;
    const maxPrice = query.maxPrice ? Number(query.maxPrice) : undefined;

    let relevanceOrder: string[] | undefined;
    let relevanceScore: Map<string, number> | undefined;
    if (query.q) {
      const matches = await this.prisma.$queryRaw<{ id: string; score: number }[]>`
        SELECT id, GREATEST(word_similarity(${query.q}, title), word_similarity(${query.q}, COALESCE(description, ''))) as score
        FROM property_listings
        WHERE status = 'active' AND (word_similarity(${query.q}, title) > 0.3 OR word_similarity(${query.q}, COALESCE(description, '')) > 0.3)
        ORDER BY score DESC
        LIMIT 50
      `;
      relevanceOrder = matches.map((m) => m.id);
      relevanceScore = new Map(matches.map((m) => [m.id, Number(m.score)]));
      if (relevanceOrder.length === 0) return [];
    }

    const listings = await this.prisma.propertyListing.findMany({
      where: {
        status: 'active',
        id: relevanceOrder ? { in: relevanceOrder } : undefined,
        listingType: query.listingType,
        verificationStatus: query.verificationStatus,
        property: {
          propertyType: query.propertyType,
          city: query.city ? { equals: query.city, mode: 'insensitive' } : undefined,
        },
        currency: query.currency ? { equals: query.currency, mode: 'insensitive' } : undefined,
        // The audit's own finding: comparing askingPrice as a raw number
        // regardless of currency let a NGN 500,000 listing and a USD
        // 500,000 listing match the same price search — not just a
        // missing control, a real correctness gap, since this codebase
        // has no FX-conversion infrastructure to make cross-currency
        // comparison meaningful in the first place. Rather than fake
        // precision with a made-up exchange rate, the price range only
        // ever applies once a currency is also specified — the frontend
        // always pairs them (see marketplace/index.tsx's own hint text),
        // and a direct API caller who omits currency gets an unfiltered-
        // but-correct result instead of a silently wrong one.
        askingPrice:
          (minPrice != null || maxPrice != null) && query.currency
            ? { gte: minPrice, lte: maxPrice }
            : undefined,
      },
      include: { property: { select: { propertyType: true, city: true, country: true } } },
      orderBy: relevanceOrder ? undefined : { createdAt: 'desc' },
    });

    // Visibility-package boost (see boost.util.ts) — every listing carries
    // its own account's `packageBadge` either way; the browse (no `q`)
    // path also moves boosted accounts' listings to the top, unconditional
    // paid placement rather than a scoring nudge. A search (`q` present)
    // deliberately leaves rankingBoost's own much smaller relevance
    // tiebreak below in sole control of order, so a boosted account can
    // never bury a strongly-relevant match — it still shows its badge,
    // just doesn't jump the queue on a real search.
    const boostMap = await getActiveBoostMap(this.prisma);
    if (!relevanceOrder || !relevanceScore) return applyVisibilityBoost(listings, boostMap);

    // Text relevance stays the dominant signal — rankingBoost only ever
    // adds up to 0.10 (no rating exists for a listing itself, so just
    // recency + verification here), nowhere near enough to let a weakly-
    // relevant match outrank a strongly-relevant one, only to break
    // near-ties between similarly-relevant results in a sensible
    // direction (newer, verified listings first).
    const scored = listings.map((listing) => ({
      listing: { ...listing, packageBadge: boostMap.get(listing.accountId) ?? null },
      finalScore:
        (relevanceScore!.get(listing.id) ?? 0) +
        rankingBoost({ createdAt: listing.createdAt, isVerified: listing.verificationStatus === 'verified' }),
    }));
    return scored.sort((a, b) => b.finalScore - a.finalScore).map((s) => s.listing);
  }

  findMine(accountId: string) {
    return this.prisma.propertyListing.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // The public one-page-website feature's own listings query — unlike
  // findMine (every listing this account has, including drafts, for the
  // owner's own dashboard), this is what a public, no-login visitor is
  // safe to see: active and under_offer only, never draft/sold/rented/
  // withdrawn, and (same as findAll's own public-browse include) never
  // the property's exact addressLine — city/country only, the same
  // privacy line this codebase's existing public marketplace browse
  // already draws.
  findPublishedForAccount(accountId: string) {
    return this.prisma.propertyListing.findMany({
      where: { accountId, status: { in: ['active', 'under_offer'] } },
      include: { property: { select: { propertyType: true, city: true, country: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // accountId is who's asking, not who owns the listing — used only to
  // report whether *this* account has favorited it, closing the gap the
  // web app's own comment used to flag (favorite state was optimistic-only
  // because there was nothing to read it back from).
  async findOne(listingId: string, accountId: string) {
    const listing = await this.prisma.propertyListing.findUnique({
      where: { id: listingId },
      include: { property: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    // A view counter, not an analytics pipeline — good enough for "does
    // anyone look at this listing" at scaffold depth.
    await this.prisma.propertyListing.update({
      where: { id: listingId },
      data: { viewCount: { increment: 1 } },
    });
    const favorite = await this.prisma.listingFavorite.findUnique({
      where: { listingId_accountId: { listingId, accountId } },
    });
    return { ...listing, isFavorited: favorite !== null };
  }

  // The audit's own finding: unlike Vendor/Supplier/Document, nothing
  // anywhere ever set PropertyListing.verificationStatus off its own
  // default — mirrors VendorsService.setVerificationStatus exactly. No
  // :propertyId param for PermissionsGuard's ABAC to key on, so this
  // reaches any listing platform-wide, same as GET /listings/:listingId
  // already does for browsing — gated by listing:verify instead, which
  // only platform_reviewer carries, never listing:write roles.
  async setVerificationStatus(listingId: string, dto: SetListingVerificationDto) {
    const listing = await this.prisma.propertyListing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Listing not found');
    return this.prisma.propertyListing.update({
      where: { id: listingId },
      data: { verificationStatus: dto.status, verificationNotes: dto.notes ?? null },
    });
  }

  // Backs generate_listing_description's Accept chaining (AiService.
  // applyChainedAction) — the only writer of Listing.description besides
  // create() itself.
  async updateDescription(listingId: string, accountId: string, description: string) {
    await this.requireOwnListing(listingId, accountId);
    return this.prisma.propertyListing.update({ where: { id: listingId }, data: { description } });
  }

  async publish(listingId: string, accountId: string) {
    const listing = await this.requireOwnListing(listingId, accountId);
    if (listing.status !== 'draft') {
      throw new BadRequestException(`Cannot publish a listing that is already "${listing.status}"`);
    }
    return this.prisma.propertyListing.update({ where: { id: listingId }, data: { status: 'active' } });
  }

  // Buyer-initiated — deliberately not ownership-gated, unlike most of this
  // service's other methods. Module 19 Phase 1's "Marketplace inquiry
  // messages" trigger — notifies the listing's own owning account, a
  // real gap since a new inquiry previously surfaced only if the owner
  // happened to check the listing's own inquiries list.
  async createInquiry(listingId: string, accountId: string, dto: CreateInquiryDto) {
    const inquiry = await this.prisma.listingInquiry.create({
      data: { listingId, accountId, ...dto },
    });
    const listing = await this.prisma.propertyListing.findUnique({ where: { id: listingId }, select: { accountId: true, title: true } });
    if (listing) {
      this.notifications.notify(
        listing.accountId,
        'listing_inquiry',
        `New inquiry on ${listing.title}`,
        dto.message,
        `/marketplace/${listingId}`,
      );
    }
    return inquiry;
  }

  async findInquiries(listingId: string, accountId: string) {
    await this.requireOwnListing(listingId, accountId);
    return this.prisma.listingInquiry.findMany({ where: { listingId }, orderBy: { createdAt: 'desc' } });
  }

  async createOffer(listingId: string, accountId: string, dto: CreateOfferDto) {
    // CreateOfferDto.currency is optional — a buyer offering in the
    // listing's own currency shouldn't have to repeat it — so fall back to
    // the listing's currency, matching the property.account.currency
    // fallback pattern used when a listing itself is created.
    const listing = await this.prisma.propertyListing.findUnique({ where: { id: listingId }, select: { currency: true } });
    if (!listing) throw new NotFoundException('Listing not found');
    return this.prisma.listingOffer.create({
      data: {
        listingId,
        accountId,
        amount: dto.amount,
        currency: dto.currency ?? listing.currency,
        message: dto.message,
      },
    });
  }

  async findOffers(listingId: string, accountId: string) {
    await this.requireOwnListing(listingId, accountId);
    return this.prisma.listingOffer.findMany({ where: { listingId }, orderBy: { amount: 'desc' } });
  }

  // The audit's own finding on Workflow 2: "PropertyInspection is real
  // but every route is ABAC-scoped to the property's own owning account
  // — there is no buyer-initiated 'request an inspection on this
  // listing' endpoint anywhere." Reuses offer:write, same permission a
  // buyer already holds to act on a listing — requesting an inspection
  // is the same kind of pre-purchase buyer action as making an offer,
  // and there's no self-request conflict a dedicated permission would
  // need to guard against (the listing's own owner already reaches
  // PropertyInspection through inspection:write on their own property).
  // Lives here rather than PropertiesService since the buyer has no
  // relationship to the property's owning account at all — the same
  // reason createOffer/createInquiry above don't delegate anywhere
  // either, they just reach PrismaService directly.
  async requestInspection(listingId: string, accountId: string, dto: RequestInspectionDto) {
    const listing = await this.prisma.propertyListing.findUnique({
      where: { id: listingId },
      select: { propertyId: true, title: true, accountId: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    const inspection = await this.prisma.propertyInspection.create({
      data: {
        propertyId: listing.propertyId,
        inspectionType: 'pre_purchase',
        status: 'requested',
        scheduledFor: new Date(dto.preferredDate),
        requestedByAccountId: accountId,
      },
    });
    this.notifications.notify(
      listing.accountId,
      'inspection_requested',
      'A buyer requested an inspection',
      `A buyer wants to inspect "${listing.title}" on ${new Date(dto.preferredDate).toLocaleDateString()}.`,
      `/properties/${listing.propertyId}`,
    );
    return inspection;
  }

  // The other side of requestInspection above — a buyer's own view of
  // every inspection request it's made across every listing, same shape
  // myOffers already gives for offers.
  myInspectionRequests(accountId: string) {
    return this.prisma.propertyInspection.findMany({
      where: { requestedByAccountId: accountId },
      include: { property: { select: { id: true, name: true, addressLine: true, city: true, country: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  myOffers(accountId: string) {
    return this.prisma.listingOffer.findMany({
      where: { accountId },
      include: { listing: { select: { id: true, title: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async respondToOffer(listingId: string, offerId: string, accountId: string, dto: RespondOfferDto) {
    const listing = await this.requireOwnListing(listingId, accountId);
    const offer = await this.prisma.listingOffer.findFirst({ where: { id: offerId, listingId } });
    if (!offer) throw new NotFoundException('Offer not found on this listing');

    const updated = await this.prisma.listingOffer.update({
      where: { id: offerId },
      data: {
        status: dto.status,
        amount: dto.status === 'countered' && dto.counterAmount != null ? dto.counterAmount : offer.amount,
      },
    });

    if (dto.status === 'accepted') {
      await this.acceptOfferIntoSale(listingId, offerId, offer.accountId, accountId, updated, listing.title, 'seller');
    } else if (dto.status === 'countered') {
      // The real gap the workflow audit found on the seller's own side —
      // RespondOfferDto has supported this since before this pass, but
      // nothing ever told the buyer it happened. See
      // ListingsController.respondToCounter for the buyer's own half.
      this.notifications.notify(
        offer.accountId,
        'listing_offer_countered',
        `Countered: ${listing.title}`,
        `The seller countered your offer at ${updated.currency} ${updated.amount}. Accept or reject it from your offers.`,
        `/marketplace/me`,
      );
    } else if (dto.status === 'rejected') {
      this.notifications.notify(
        offer.accountId,
        'listing_offer_rejected',
        `Offer declined: ${listing.title}`,
        `The seller declined your offer.`,
        `/marketplace/${listingId}`,
      );
    }
    return updated;
  }

  // The buyer's own half of the counter-offer loop — RespondOfferDto
  // above is seller-only (gated by requireOwnListing), so a countered
  // offer had no path forward at all for the account that has to act on
  // it next. Deliberately narrower than the seller's own response: this
  // pass is accept-or-walk-away, not a full back-and-forth (see
  // RespondToCounterDto's own comment).
  async respondToCounter(listingId: string, offerId: string, accountId: string, dto: RespondToCounterDto) {
    const offer = await this.prisma.listingOffer.findFirst({ where: { id: offerId, listingId, accountId } });
    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.status !== 'countered') {
      throw new BadRequestException(`This offer isn't awaiting your response (status: "${offer.status}")`);
    }
    const listing = await this.prisma.propertyListing.findUniqueOrThrow({ where: { id: listingId } });

    // Included the same shape myOffers() itself selects — the caller is
    // this offer's own row on the buyer's "me" page (MyListingsPage),
    // which links out through o.listing.id; without it here, accepting
    // or rejecting would blank that link the instant this response
    // replaces the row in local state.
    const updated = await this.prisma.listingOffer.update({
      where: { id: offerId },
      data: { status: dto.status },
      include: { listing: { select: { id: true, title: true, status: true } } },
    });

    if (dto.status === 'accepted') {
      await this.acceptOfferIntoSale(listingId, offerId, accountId, listing.accountId, updated, listing.title, 'buyer');
    } else {
      this.notifications.notify(
        listing.accountId,
        'listing_counter_rejected',
        `Counter-offer declined: ${listing.title}`,
        `The buyer declined your counter-offer.`,
        `/marketplace/${listingId}`,
      );
    }
    return updated;
  }

  // Shared by both real "an offer just became accepted" paths above —
  // the seller directly accepting a fresh offer, and a buyer accepting
  // the seller's own counter — so the sale/notification logic exists
  // exactly once rather than twice. `initiatedBy` decides who gets told
  // "accepted" (never the account that just clicked the button — they
  // already know) and which side of the transaction that message names.
  private async acceptOfferIntoSale(
    listingId: string,
    offerId: string,
    buyerAccountId: string,
    sellerAccountId: string,
    offer: { amount: unknown; currency: string },
    listingTitle: string,
    initiatedBy: 'seller' | 'buyer',
  ) {
    await this.prisma.propertyListing.update({ where: { id: listingId }, data: { status: 'under_offer' } });
    // `upsert`, not `create` — guards against a double-accept on the same
    // listing (neither respondToOffer nor respondToCounter itself
    // prevents a second "accepted" call on a different offer) ever
    // crashing on the unique listingId constraint; it just leaves the
    // original sale's own buyer/amount as the real one.
    await this.prisma.listingSale.upsert({
      where: { listingId },
      update: {},
      create: {
        listingId,
        offerId,
        buyerAccountId,
        sellerAccountId,
        amount: offer.amount as never,
        currency: offer.currency,
      },
    });
    if (initiatedBy === 'seller') {
      this.notifications.notify(
        buyerAccountId,
        'listing_offer_accepted',
        `Your offer on ${listingTitle} was accepted`,
        `Next: complete the document checklist and record your deposit to close the sale.`,
        `/marketplace/${listingId}`,
      );
    } else {
      this.notifications.notify(
        sellerAccountId,
        'listing_offer_accepted',
        `Your counter-offer on ${listingTitle} was accepted`,
        `Next: complete the document checklist and record your deposit to close the sale.`,
        `/marketplace/${listingId}`,
      );
    }
  }

  // The document checklist itself is never stored — it's computed live
  // from the property's own real Document rows against the same fixed
  // checklist verify_property_documents already uses, so a document
  // verified (or newly uploaded) after the sale started is reflected
  // immediately, with nothing to keep in sync by hand.
  async getSale(listingId: string, accountId: string) {
    const sale = await this.requireSaleParty(listingId, accountId);
    const listing = await this.prisma.propertyListing.findUniqueOrThrow({
      where: { id: listingId },
      select: { propertyId: true, title: true },
    });
    const documents = await this.prisma.document.findMany({ where: { propertyId: listing.propertyId } });
    const checklist = DEFAULT_DOCUMENT_CHECKLIST.map((documentType) => {
      const found = documents.find((d) => d.documentType === documentType);
      return {
        documentType,
        label: labelDocumentType(documentType),
        status: found ? found.verificationStatus : 'missing',
      };
    });
    return { ...sale, listingTitle: listing.title, checklist };
  }

  // Record-only, same restraint as LeaseRentPayment — logs that a
  // deposit happened, doesn't move any money. Idempotent: a second call
  // after one has already been recorded just returns the sale unchanged
  // rather than resetting the timestamp.
  async recordDeposit(listingId: string, accountId: string) {
    const sale = await this.requireSaleParty(listingId, accountId);
    if (sale.completedAt) throw new BadRequestException('This sale is already completed');
    if (sale.depositRecordedAt) return sale;
    return this.prisma.listingSale.update({ where: { id: sale.id }, data: { depositRecordedAt: new Date() } });
  }

  // The other real gap the audit found: nothing ever set a listing to
  // "sold" or moved the property into the buyer's own portfolio.
  // Property.accountId is the one field every permission/ABAC check in
  // this codebase already keys on for "who owns this" — reassigning it
  // is a real, immediate transfer: the buyer's account can now reach
  // GET /properties and see it, and every existing lease/project/
  // document/timeline entry comes along with it, unchanged (a real
  // buyer inherits exactly what's actually on the property, not a
  // stripped-down copy). Deliberately gated on both real preconditions —
  // a recorded deposit and every checklist document actually verified —
  // rather than a button that always works regardless of state.
  async completeSale(listingId: string, accountId: string) {
    const sale = await this.requireSaleParty(listingId, accountId);
    if (sale.completedAt) throw new BadRequestException('This sale is already completed');
    if (!sale.depositRecordedAt) {
      throw new BadRequestException('Record the deposit before completing the sale');
    }

    const listing = await this.prisma.propertyListing.findUniqueOrThrow({ where: { id: listingId } });
    const documents = await this.prisma.document.findMany({ where: { propertyId: listing.propertyId } });
    const missing = DEFAULT_DOCUMENT_CHECKLIST.filter(
      (documentType) => !documents.some((d) => d.documentType === documentType && d.verificationStatus === 'verified'),
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        `Document checklist incomplete — not yet verified: ${missing.map(labelDocumentType).join(', ')}`,
      );
    }

    const [, , property] = await this.prisma.$transaction([
      this.prisma.listingSale.update({ where: { id: sale.id }, data: { completedAt: new Date() } }),
      this.prisma.propertyListing.update({ where: { id: listingId }, data: { status: 'sold' } }),
      this.prisma.property.update({ where: { id: listing.propertyId }, data: { accountId: sale.buyerAccountId } }),
    ]);
    await this.prisma.propertyTimelineEvent.create({
      data: {
        propertyId: listing.propertyId,
        eventType: 'sold',
        label: `Sold via marketplace listing "${listing.title}" — ownership transferred`,
      },
    });
    this.notifications.notify(
      sale.buyerAccountId,
      'listing_sale_completed',
      `Purchase complete: ${listing.title}`,
      `This property now appears in your own portfolio.`,
      `/properties/${listing.propertyId}`,
    );
    this.notifications.notify(
      sale.sellerAccountId,
      'listing_sale_completed',
      `Sale complete: ${listing.title}`,
      `Ownership has been transferred to the buyer.`,
      `/marketplace/me`,
    );
    return property;
  }

  private async requireSaleParty(listingId: string, accountId: string) {
    const sale = await this.prisma.listingSale.findUnique({ where: { listingId } });
    if (!sale) throw new NotFoundException('No sale on this listing yet — an offer must be accepted first');
    if (sale.buyerAccountId !== accountId && sale.sellerAccountId !== accountId) {
      throw new NotFoundException('No sale on this listing yet — an offer must be accepted first');
    }
    return sale;
  }

  async favorite(listingId: string, accountId: string) {
    const existing = await this.prisma.listingFavorite.findUnique({
      where: { listingId_accountId: { listingId, accountId } },
    });
    if (existing) return existing;
    return this.prisma.listingFavorite.create({ data: { listingId, accountId } });
  }

  unfavorite(listingId: string, accountId: string) {
    return this.prisma.listingFavorite
      .delete({ where: { listingId_accountId: { listingId, accountId } } })
      .catch(() => ({ removed: false }));
  }

  myFavorites(accountId: string) {
    return this.prisma.listingFavorite.findMany({
      where: { accountId },
      include: { listing: { select: { id: true, title: true, askingPrice: true, currency: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
