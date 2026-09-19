import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ListingsService } from '../listings/listings.service';
import { getVendorTrustScore } from '../vendors/trust-score';
import { getSupplierTrustScore } from '../materials/trust-score';
import { getActiveBoostMap, applyVisibilityBoost, getActiveBoostForAccount } from '../packages/boost.util';

// A user-requested feature (not from the numbered blueprint): "every
// company, user, vendor... to have a one page website that contains
// their listings and summary of their business." This is the first
// genuinely public, no-login surface in this codebase beyond the two
// token-gated invite previews (AccountsService.getInvite,
// DevelopmentAgreementsService.getByToken) — everything else, including
// every "public marketplace browse" route this codebase already has
// (GET /vendors/:id, GET /suppliers/:id, GET /listings), still sits
// behind JwtAuthGuard. That changes the safety bar: this service hand-
// picks exactly which fields leave the building, rather than reusing
// VendorsService.findOne/MaterialsService.findSupplier's own return
// shapes directly — those include Vendor's bank/payout fields
// (bankAccountNumber, paystackRecipientCode, ...), verificationNotes
// (a platform_reviewer's internal note), and a trust score's
// latestAudit.notes (also internal) — none of which belong on a page
// anyone on the internet can load with no credential at all.
@Injectable()
export class PublicProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
  ) {}

  async getProfile(accountId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, name: true, accountType: true, status: true, createdAt: true },
    });
    // TENANT accounts get no public page at all — they own nothing to
    // list and run no business to summarize, and a public "here's a
    // renter" page would only ever be a privacy cost with no offsetting
    // value. A suspended account (Account.status, Module 16) is treated
    // as not found too — the same "the account isn't really usable right
    // now" reasoning AccountContextGuard already applies to its own
    // members, extended to the public view.
    if (!account || account.accountType === 'TENANT' || account.status === 'suspended') {
      throw new NotFoundException('This page does not exist');
    }

    const base = {
      accountId: account.id,
      accountName: account.name,
      accountType: account.accountType,
      memberSince: account.createdAt,
      packageBadge: await getActiveBoostForAccount(this.prisma, account.id),
    };

    if (account.accountType === 'VENDOR') {
      const vendor = await this.prisma.vendor.findUnique({ where: { accountId } });
      if (!vendor) return { ...base, vendor: null, listings: [] };
      const trustScore = await getVendorTrustScore(this.prisma, vendor);
      const reviews = await this.prisma.vendorReview.findMany({
        where: { vendorId: vendor.id, moderationStatus: { not: 'hidden' } },
        select: { rating: true, comment: true, response: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      return {
        ...base,
        vendor: {
          businessName: vendor.businessName,
          serviceCategory: vendor.serviceCategory,
          locationCoverage: vendor.locationCoverage,
          photoUrl: vendor.photoUrl,
          verificationStatus: vendor.verificationStatus,
          ratingAverage: vendor.ratingAverage,
          trustScore: { score: trustScore.score, band: trustScore.band },
          reviews,
        },
      };
    }

    if (account.accountType === 'SUPPLIER') {
      const supplier = await this.prisma.supplier.findUnique({ where: { accountId } });
      if (!supplier) return { ...base, supplier: null };
      const trustScore = await getSupplierTrustScore(this.prisma, supplier);
      const [reviews, products] = await Promise.all([
        this.prisma.supplierReview.findMany({
          where: { supplierId: supplier.id, moderationStatus: { not: 'hidden' } },
          select: { rating: true, comment: true, response: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        this.prisma.product.findMany({
          where: { supplierId: supplier.id, status: 'active' },
          select: {
            id: true,
            name: true,
            category: true,
            unit: true,
            unitPrice: true,
            currency: true,
            description: true,
            isRentable: true,
            rentalPricePerDay: true,
            photoUrls: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      return {
        ...base,
        supplier: {
          businessName: supplier.businessName,
          category: supplier.category,
          locationCoverage: supplier.locationCoverage,
          photoUrl: supplier.photoUrl,
          verificationStatus: supplier.verificationStatus,
          ratingAverage: supplier.ratingAverage,
          trustScore: { score: trustScore.score, band: trustScore.band },
          reviews,
          products,
        },
      };
    }

    // INDIVIDUAL / FAMILY / COMPANY — an owning account's "business" is
    // its published listings; there's no bio/logo/description field
    // anywhere on Account to show instead (confirmed: Account.name is
    // genuinely the only identifying text field this schema has for an
    // owner-type account).
    const rawListings = await this.listings.findPublishedForAccount(accountId);
    const listings = rawListings.map((l) => ({
      id: l.id,
      listingType: l.listingType,
      askingPrice: l.askingPrice,
      currency: l.currency,
      title: l.title,
      description: l.description,
      photoUrls: l.photoUrls,
      propertyType: l.property.propertyType,
      city: l.property.city,
      country: l.property.country,
    }));
    return { ...base, listings };
  }

  // The landing page's own public data need: a real, small cross-section
  // of the marketplace — not the full authenticated browse
  // (VendorsService.findAll/MaterialsService.findProducts/ListingsService
  // .findAll all still sit behind JwtAuthGuard, and VendorsService.findAll
  // in particular returns the same raw row — bank/payout fields included
  // — GetProfile's own comment already flags). Same hand-picked-whitelist
  // discipline as getProfile: every vendor/supplier card carries only
  // what's already safe to show a stranger, and links back to that
  // account's own /go/:accountId page rather than any authenticated
  // route. Capped small (6 each) — a landing page teaser, not a browse
  // page; deliberately not paginated.
  async getMarketplaceHighlights() {
    // Candidate pool wider than the final take:6 (capped at 30 — this is
    // a landing-page teaser, not a real paginated query) so a currently-
    // boosted account can actually surface into the final six even when
    // it isn't already top-rated/most-recent — see boost.util.ts. The
    // boost partition + re-slice to 6 happens in JS below, once per list,
    // after this fetch.
    const [listingRows, vendorRows, supplierRows, boostMap] = await Promise.all([
      this.prisma.propertyListing.findMany({
        where: { status: { in: ['active', 'under_offer'] } },
        include: { property: { select: { propertyType: true, city: true, country: true } } },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.prisma.vendor.findMany({
        where: { verificationStatus: 'verified' },
        orderBy: [{ ratingAverage: 'desc' }, { createdAt: 'desc' }],
        take: 30,
      }),
      this.prisma.supplier.findMany({
        where: { verificationStatus: 'verified' },
        orderBy: [{ ratingAverage: 'desc' }, { createdAt: 'desc' }],
        take: 30,
      }),
      getActiveBoostMap(this.prisma),
    ]);

    // Boost partition happens on the raw rows, before the trust-score
    // computation below (one query per row) — slicing to the final 6
    // first means that work only ever runs for accounts that actually
    // make the cut, boosted or not.
    const boostedListingRows = applyVisibilityBoost(listingRows, boostMap).slice(0, 6);
    const boostedVendorRows = applyVisibilityBoost(vendorRows, boostMap).slice(0, 6);
    const boostedSupplierRows = applyVisibilityBoost(supplierRows, boostMap).slice(0, 6);

    const listings = boostedListingRows.map((l) => ({
      id: l.id,
      accountId: l.accountId,
      listingType: l.listingType,
      askingPrice: l.askingPrice,
      currency: l.currency,
      title: l.title,
      photoUrls: l.photoUrls,
      propertyType: l.property.propertyType,
      city: l.property.city,
      country: l.property.country,
      packageBadge: l.packageBadge,
    }));

    const vendors = await Promise.all(
      boostedVendorRows.map(async (v) => {
        const trustScore = await getVendorTrustScore(this.prisma, v);
        return {
          accountId: v.accountId,
          businessName: v.businessName,
          serviceCategory: v.serviceCategory,
          locationCoverage: v.locationCoverage,
          photoUrl: v.photoUrl,
          ratingAverage: v.ratingAverage,
          trustScore: { score: trustScore.score, band: trustScore.band },
          packageBadge: v.packageBadge,
        };
      }),
    );

    const suppliers = await Promise.all(
      boostedSupplierRows.map(async (s) => {
        const trustScore = await getSupplierTrustScore(this.prisma, s);
        return {
          accountId: s.accountId,
          businessName: s.businessName,
          category: s.category,
          locationCoverage: s.locationCoverage,
          photoUrl: s.photoUrl,
          ratingAverage: s.ratingAverage,
          trustScore: { score: trustScore.score, band: trustScore.band },
          packageBadge: s.packageBadge,
        };
      }),
    );

    return { listings, vendors, suppliers };
  }
}
