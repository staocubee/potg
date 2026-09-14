import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { SubmitQuoteDto } from './dto/submit-quote.dto';
import { SubmitMaintenanceQuoteDto } from './dto/submit-maintenance-quote.dto';
import { CreateVendorReviewDto } from './dto/create-vendor-review.dto';
import { UpdateVendorReviewDto } from './dto/update-vendor-review.dto';
import { ReplyToReviewDto } from './dto/reply-to-review.dto';
import { FlagReviewDto } from './dto/flag-review.dto';
import { ModerateReviewDto } from './dto/moderate-review.dto';
import { SetVendorVerificationDto } from './dto/set-vendor-verification.dto';
import { SubmitVendorTrustAuditDto } from './dto/submit-vendor-trust-audit.dto';
import { SetVendorBankDetailsDto } from './dto/set-vendor-bank-details.dto';
import { SetPaypalPayoutEmailDto } from './dto/set-paypal-payout-email.dto';
import { SetVendorLicenseDto } from './dto/set-vendor-license.dto';
import { SubmitVendorVerificationEvidenceDto } from './dto/submit-vendor-verification-evidence.dto';
import { rankingBoost } from '../common/search-ranking.util';
import { getActiveBoostMap, applyVisibilityBoost } from '../packages/boost.util';
import { getVendorTrustScore } from './trust-score';
import { PaystackService } from '../payments/paystack.service';
import { FlutterwaveService } from '../payments/flutterwave.service';

@Injectable()
export class VendorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackService,
    private readonly flutterwave: FlutterwaveService,
  ) {}

  // Paystack and Flutterwave bank codes are not interchangeable for the
  // same physical bank (see the schema comment on Vendor.bankCode) — this
  // is the one place that resolves "which gateway's bank list/resolver"
  // for a given provider name, shared by setBankDetails and listBanks so
  // they can never disagree about it.
  private bankGatewayFor(provider?: string) {
    if (provider === 'flutterwave') return this.flutterwave;
    return this.paystack;
  }

  // One Vendor profile per account (@@unique accountId on the model) — the
  // account is what auth/RBAC already understands, this is the
  // marketplace-facing profile layered on top of a VENDOR-type account.
  async create(accountId: string, dto: CreateVendorDto) {
    const existing = await this.prisma.vendor.findUnique({ where: { accountId } });
    if (existing) {
      throw new ConflictException('This account already has a vendor profile — use PATCH to update it');
    }
    return this.prisma.vendor.create({ data: { accountId, ...dto } });
  }

  // The real half of Section 16's payout integration — see
  // PaymentsService.releaseMilestone's own comment. Resolves the account
  // number against the chosen gateway's own records first (never trusting
  // a client-supplied account holder name), so bankAccountName is always
  // whatever the gateway itself says the account belongs to. Records
  // which gateway these details are for (payoutProvider) — Paystack's own
  // bank codes and Flutterwave's are not interchangeable, so
  // PaymentsService.releaseMilestone needs to know which one to route a
  // payout through. Always clears any cached paystackRecipientCode: a
  // changed or re-targeted bank account needs a fresh Transfer Recipient
  // if it ends up going through Paystack again, the old one no longer
  // applies.
  async setBankDetails(accountId: string, dto: SetVendorBankDetailsDto) {
    const vendor = await this.prisma.vendor.findUnique({ where: { accountId } });
    if (!vendor) {
      throw new BadRequestException('This account has no vendor profile yet — create one with POST /vendors first');
    }
    const provider = dto.provider ?? 'paystack';
    const resolved = await this.bankGatewayFor(provider).resolveAccountNumber(dto.bankAccountNumber, dto.bankCode);
    return this.prisma.vendor.update({
      where: { id: vendor.id },
      data: {
        bankAccountNumber: dto.bankAccountNumber,
        bankCode: dto.bankCode,
        bankAccountName: resolved.accountName,
        payoutProvider: provider,
        paystackRecipientCode: null,
      },
    });
  }

  listBanks(provider?: string) {
    return this.bankGatewayFor(provider).listBanks('NGN');
  }

  // Self-reported, unverified — see the schema comment on
  // Vendor.licenseNumber for why this never boosts the trust score, only
  // an expired one costs it (computeVendorTrustScore). No resolve/verify
  // step against an external registry exists here (none is wired up in
  // this scaffold), so this is deliberately the same trust level as
  // Lease.tenantName or MaintenanceRequest.assignedTo — recorded, not
  // audited, until a platform_reviewer actually looks into it and files a
  // VendorTrustAudit that says so.
  async setLicense(accountId: string, dto: SetVendorLicenseDto) {
    const vendor = await this.prisma.vendor.findUnique({ where: { accountId } });
    if (!vendor) {
      throw new BadRequestException('This account has no vendor profile yet — create one with POST /vendors first');
    }
    return this.prisma.vendor.update({
      where: { id: vendor.id },
      data: {
        licenseNumber: dto.licenseNumber,
        licenseIssuingBody: dto.licenseIssuingBody,
        licenseExpiresAt: new Date(dto.licenseExpiresAt),
      },
    });
  }

  // The PayPal counterpart to setBankDetails — a payout email instead of
  // a bank account, since PayPal's Payouts API pays a receiver by email,
  // not a local bank rail (see PaypalService's own comment). No
  // resolve/verify step exists for this the way bank details get one:
  // PayPal itself validates the receiver when a payout is actually sent,
  // there's no equivalent "confirm this account is real" call to make
  // ahead of time.
  async setPaypalPayoutEmail(accountId: string, dto: SetPaypalPayoutEmailDto) {
    const vendor = await this.prisma.vendor.findUnique({ where: { accountId } });
    if (!vendor) {
      throw new BadRequestException('This account has no vendor profile yet — create one with POST /vendors first');
    }
    return this.prisma.vendor.update({
      where: { id: vendor.id },
      data: { paypalPayoutEmail: dto.email, payoutProvider: 'paypal' },
    });
  }

  // Marketplace browse — Module 7's "search/filter vendors by service
  // category and location". No tenant isolation here on purpose: browsing
  // the marketplace is cross-account by design.
  //
  // `q` closes "no free-text search in any marketplace" for this one —
  // same pg_trgm-backed "$queryRaw for matching ids, Prisma findMany to
  // hydrate, re-sort in JS" split ListingsService.findAll's own comment
  // explains in full.
  // The audit's own finding: "cards display location/rating/verification,
  // but there are no server-side query params to filter on them at all."
  // Three new optional filters, same shape serviceCategory already used:
  // location is a real substring match against the vendor's own freeform
  // locationCoverage text (there's no fixed region taxonomy to match
  // exactly against), minRating is a real numeric floor, verificationStatus
  // is exact — mirrors ListingsService.findAll's own verificationStatus
  // filter added for the marketplace listing side of this same gap.
  async findAll(serviceCategory?: string, q?: string, location?: string, minRating?: string, verificationStatus?: string) {
    let relevanceOrder: string[] | undefined;
    let relevanceScore: Map<string, number> | undefined;
    if (q) {
      // word_similarity() against an explicit 0.3 threshold — see
      // ListingsService.findAll's comment for why this, and specifically
      // why not the `<%` operator (its default threshold GUC is a
      // stricter 0.6, not the 0.3 plain similarity/`%` uses).
      const matches = await this.prisma.$queryRaw<{ id: string; score: number }[]>`
        SELECT id, word_similarity(${q}, "businessName") as score FROM vendors
        WHERE word_similarity(${q}, "businessName") > 0.3
        ORDER BY score DESC
        LIMIT 50
      `;
      relevanceOrder = matches.map((m) => m.id);
      relevanceScore = new Map(matches.map((m) => [m.id, Number(m.score)]));
      if (relevanceOrder.length === 0) return [];
    }

    const vendors = await this.prisma.vendor.findMany({
      where: {
        serviceCategory: serviceCategory || undefined,
        id: relevanceOrder ? { in: relevanceOrder } : undefined,
        locationCoverage: location ? { contains: location, mode: 'insensitive' } : undefined,
        ratingAverage: minRating ? { gte: Number(minRating) } : undefined,
        verificationStatus: verificationStatus || undefined,
      },
      orderBy: relevanceOrder ? undefined : [{ ratingAverage: 'desc' }, { createdAt: 'desc' }],
    });

    // Visibility-package boost — see ListingsService.findAll's own comment
    // on the same split (browse gets unconditional top placement, search
    // only gets the badge plus rankingBoost's much smaller tiebreak).
    const boostMap = await getActiveBoostMap(this.prisma);
    if (!relevanceOrder || !relevanceScore) return applyVisibilityBoost(vendors, boostMap);
    // See ListingsService.findAll's own comment on rankingBoost — text
    // relevance stays dominant, this only breaks near-ties. Vendors get
    // all three signals (rating, verification, recency), unlike listings.
    const scored = vendors.map((vendor) => ({
      vendor: { ...vendor, packageBadge: boostMap.get(vendor.accountId) ?? null },
      finalScore:
        (relevanceScore!.get(vendor.id) ?? 0) +
        rankingBoost({
          createdAt: vendor.createdAt,
          ratingAverage: vendor.ratingAverage ? Number(vendor.ratingAverage) : null,
          isVerified: vendor.verificationStatus === 'verified',
        }),
    }));
    return scored.sort((a, b) => b.finalScore - a.finalScore).map((s) => s.vendor);
  }

  // Module 6's "trust score" — computed on read, not stored, since too many
  // separate flows touch its inputs (review CRUD, verification status,
  // project completion, dispute resolution) to keep a denormalized column
  // correctly in sync the way Vendor.ratingAverage's narrower recompute
  // hook can. Formula lives in trust-score.ts, shared with the
  // explain_vendor_trust_score AI skill so both read the same numbers.
  async findForAccount(accountId: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { accountId },
      include: { reviews: { orderBy: { createdAt: 'desc' } } },
    });
    if (!vendor) return vendor;
    return { ...vendor, trustScore: await getVendorTrustScore(this.prisma, vendor) };
  }

  // Public marketplace view — hides a review moderateReview has marked
  // "hidden" (findForAccount, the vendor's own view of its profile, shows
  // every review including hidden ones so the vendor can see why one
  // disappeared publicly).
  async findOne(id: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id },
      include: { reviews: { where: { moderationStatus: { not: 'hidden' } }, orderBy: { createdAt: 'desc' } } },
    });
    if (!vendor) return vendor;
    return { ...vendor, trustScore: await getVendorTrustScore(this.prisma, vendor) };
  }

  // Module 6's actual neutral-reviewer action — gated on vendor:verify,
  // which only the platform_reviewer role carries (never the vendor role
  // itself, see seed.ts), so a vendor can never set its own status. No
  // :accountId/:propertyId param for PermissionsGuard's ABAC to key on, so
  // this reaches any vendor on the platform, same as GET /vendors/:id
  // already does for browsing.
  async setVerificationStatus(vendorId: string, dto: SetVendorVerificationDto) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return this.prisma.vendor.update({
      where: { id: vendorId },
      data: { verificationStatus: dto.status, verificationNotes: dto.notes ?? null },
    });
  }

  // The structured "submit more evidence" channel vendor verification was
  // missing — see VendorVerificationEvidence's own schema comment.
  // "pending" (SetVendorVerificationDto's own comment) was already meant
  // as the "awaiting evidence" status; this is what actually lets the
  // vendor respond to it, mirroring PaymentsService.submitDisputeEvidence/
  // DocumentsService.submitEvidence — one owning account here too, not
  // two parties.
  async submitVerificationEvidence(accountId: string, userId: string, dto: SubmitVendorVerificationEvidenceDto) {
    const vendor = await this.prisma.vendor.findUnique({ where: { accountId } });
    if (!vendor) throw new NotFoundException('Vendor profile not found');
    if (vendor.verificationStatus === 'verified') {
      throw new BadRequestException('This vendor is already verified — nothing more to submit');
    }
    return this.prisma.vendorVerificationEvidence.create({
      data: { vendorId: vendor.id, submittedByUserId: userId, note: dto.note, fileUrl: dto.fileUrl },
    });
  }

  // The vendor's own view of what it already submitted.
  findMyVerificationEvidence(accountId: string) {
    return this.prisma.vendor.findUnique({ where: { accountId } }).verificationEvidence({ orderBy: { createdAt: 'asc' } });
  }

  // The reviewer's view — same vendor:verify gate as setVerificationStatus
  // itself, reaches any vendor's evidence platform-wide.
  findVerificationEvidence(vendorId: string) {
    return this.prisma.vendorVerificationEvidence.findMany({ where: { vendorId }, orderBy: { createdAt: 'asc' } });
  }

  // The actual audit step — see VendorTrustAudit's own schema comment for
  // how this differs from setVerificationStatus above (a gate, set and
  // overwritten) and from a customer's own VendorReview. Gated on the
  // same vendor:verify permission as setVerificationStatus — only
  // platform_reviewer carries it — so this can't be used to self-audit
  // any more than the verification gate itself can.
  async submitTrustAudit(vendorId: string, reviewedByUserId: string, dto: SubmitVendorTrustAuditDto) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return this.prisma.vendorTrustAudit.create({
      data: { vendorId, reviewedByUserId, rating: dto.rating, notes: dto.notes },
    });
  }

  // Read-only, gated on vendor:read like the profile itself — the full
  // audit trail is visible to anyone who can see the vendor at all, the
  // same transparency reviews already get, not just the most recent one
  // the trust score itself reads.
  findTrustAudits(vendorId: string) {
    return this.prisma.vendorTrustAudit.findMany({ where: { vendorId }, orderBy: { createdAt: 'desc' } });
  }

  // Vendor-initiated: submitting or revising a quote on a project. This
  // deliberately does not go through the :projectId ABAC check in
  // PermissionsGuard (the vendor's account doesn't own the project) — the
  // only tenant check that applies here is "this account has a vendor
  // profile at all".
  async submitQuote(accountId: string, dto: SubmitQuoteDto) {
    const vendor = await this.prisma.vendor.findUnique({ where: { accountId } });
    if (!vendor) {
      throw new BadRequestException('This account has no vendor profile yet — create one with POST /vendors first');
    }
    const project = await this.prisma.project.findUnique({ where: { id: dto.projectId } });
    if (!project) throw new NotFoundException('Project not found');

    const existing = await this.prisma.vendorQuote.findFirst({
      where: { projectId: dto.projectId, vendorId: vendor.id },
    });
    if (existing) {
      return this.prisma.vendorQuote.update({
        where: { id: existing.id },
        data: {
          amount: dto.amount,
          currency: dto.currency ?? existing.currency,
          notes: dto.notes,
          status: 'submitted',
        },
      });
    }
    return this.prisma.vendorQuote.create({
      data: {
        projectId: dto.projectId,
        vendorId: vendor.id,
        amount: dto.amount,
        currency: dto.currency ?? project.currency,
        notes: dto.notes,
        status: 'submitted',
      },
    });
  }

  myQuotes(accountId: string) {
    return this.prisma.vendorQuote.findMany({
      where: { vendor: { accountId } },
      include: { project: { select: { id: true, title: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // The real gap the workflow audit flagged: a vendor can already reach
  // GET /projects/:projectId and post progress updates once assigned
  // (@AllowAssignedVendor() on ProjectsController), but had no way to
  // discover which projects those even are — myQuotes only shows quotes
  // it submitted, not projects it was actually hired onto. This is the
  // real "hired" signal (ProjectVendorAssignment), not just any quote.
  myProjects(accountId: string) {
    return this.prisma.projectVendorAssignment.findMany({
      where: { vendor: { accountId } },
      include: {
        project: {
          select: {
            id: true,
            title: true,
            status: true,
            currency: true,
            property: { select: { name: true } },
            stages: { select: { name: true, status: true, sortOrder: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // The maintenance-side counterpart to myProjects — same discoverability
  // gap, same fix shape: a vendor was already reachable as
  // MaintenanceRequest.assignedVendorId with zero way to actually find that
  // request, since every maintenance route lived under PropertiesController
  // (:propertyId-scoped, ABAC-blocked for a non-owning account). Read-only,
  // scoped to "assigned to me," the same shape every other vendor "me"
  // route already uses.
  myMaintenanceRequests(accountId: string) {
    return this.prisma.maintenanceRequest.findMany({
      where: { assignedVendor: { accountId } },
      include: { property: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Vendor-initiated, mirroring submitQuote's own reasoning: deliberately
  // doesn't go through the :propertyId ABAC check in PermissionsGuard (a
  // vendor's account doesn't own the property) — the only check here is
  // "this account has a vendor profile, and that profile is the one this
  // request is actually assigned to." Upserts on the request itself (see
  // MaintenanceRequest.quotedAmount's own schema comment for why this
  // isn't a VendorQuote row) rather than creating a new record, so
  // re-quoting just overwrites the last figure, same as submitQuote's own
  // upsert-by-(projectId, vendorId) behavior.
  async submitMaintenanceQuote(accountId: string, dto: SubmitMaintenanceQuoteDto) {
    const vendor = await this.prisma.vendor.findUnique({ where: { accountId } });
    if (!vendor) {
      throw new BadRequestException('This account has no vendor profile yet — create one with POST /vendors first');
    }
    const request = await this.prisma.maintenanceRequest.findUnique({ where: { id: dto.maintenanceRequestId } });
    if (!request) throw new NotFoundException('Maintenance request not found');
    if (request.assignedVendorId !== vendor.id) {
      throw new BadRequestException('This maintenance request is not assigned to you');
    }
    if (request.status !== 'open' && request.status !== 'in_progress') {
      throw new BadRequestException(`This request is already "${request.status}" — no quote to submit against it`);
    }
    return this.prisma.maintenanceRequest.update({
      where: { id: dto.maintenanceRequestId },
      data: {
        quotedAmount: dto.amount,
        quotedCurrency: dto.currency ?? 'USD',
        quotedNotes: dto.notes,
        quotedAt: new Date(),
      },
    });
  }

  // A vendor checking what it's actually been paid — Payout rows are only
  // ever created by PaymentsService.releaseMilestone, this is read-only.
  myPayouts(accountId: string) {
    return this.prisma.payout.findMany({
      where: { vendor: { accountId } },
      include: { project: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Called from ProjectsController (POST /projects/:projectId/reviews) so
  // the review inherits PermissionsGuard's :projectId ABAC check for free —
  // by the time this runs, `accountId` is already confirmed to own the
  // project. Two more gates live here: the project must be "completed"
  // (ProjectsService.complete), and the vendor must actually have worked on
  // it (a ProjectVendorAssignment, not just any vendor id).
  async createReview(projectId: string, accountId: string, dto: CreateVendorReviewDto) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.status !== 'completed') {
      throw new BadRequestException('Only a completed project can be reviewed — mark it complete first');
    }

    const assignment = await this.prisma.projectVendorAssignment.findUnique({
      where: { projectId_vendorId: { projectId, vendorId: dto.vendorId } },
    });
    if (!assignment) {
      throw new BadRequestException('This vendor was never assigned to this project');
    }

    const existing = await this.prisma.vendorReview.findUnique({
      where: { projectId_vendorId: { projectId, vendorId: dto.vendorId } },
    });
    if (existing) {
      throw new ConflictException('This project has already been reviewed for this vendor');
    }

    const review = await this.prisma.vendorReview.create({
      data: { vendorId: dto.vendorId, projectId, accountId, rating: dto.rating, comment: dto.comment },
    });
    await this.recomputeRating(dto.vendorId);
    return review;
  }

  // Excludes "hidden" reviews (but not "flagged" ones — a flag alone
  // doesn't change the score, only a moderator confirming it should) so a
  // review a moderator hides for spam/abuse stops inflating or deflating
  // the vendor's rating.
  private async recomputeRating(vendorId: string) {
    const { _avg } = await this.prisma.vendorReview.aggregate({
      where: { vendorId, moderationStatus: { not: 'hidden' } },
      _avg: { rating: true },
    });
    await this.prisma.vendor.update({
      where: { id: vendorId },
      data: { ratingAverage: _avg.rating ?? null },
    });
  }

  // Reviewer-side edit — same ABAC-via-:projectId shape as createReview
  // (called from ProjectsController), plus an explicit accountId check
  // since a review's own accountId is the source of truth for who left it,
  // not just "whoever currently owns this project." Recomputes the
  // vendor's ratingAverage since the rating itself can change.
  async updateReview(projectId: string, reviewId: string, accountId: string, dto: UpdateVendorReviewDto) {
    const review = await this.prisma.vendorReview.findFirst({ where: { id: reviewId, projectId } });
    if (!review) throw new NotFoundException('Review not found on this project');
    if (review.accountId !== accountId) {
      throw new ForbiddenException('Only the account that left this review can edit it');
    }
    const updated = await this.prisma.vendorReview.update({
      where: { id: reviewId },
      data: { rating: dto.rating ?? review.rating, comment: dto.comment !== undefined ? dto.comment : review.comment },
    });
    if (dto.rating !== undefined) await this.recomputeRating(review.vendorId);
    return updated;
  }

  async deleteReview(projectId: string, reviewId: string, accountId: string) {
    const review = await this.prisma.vendorReview.findFirst({ where: { id: reviewId, projectId } });
    if (!review) throw new NotFoundException('Review not found on this project');
    if (review.accountId !== accountId) {
      throw new ForbiddenException('Only the account that left this review can delete it');
    }
    await this.prisma.vendorReview.delete({ where: { id: reviewId } });
    await this.recomputeRating(review.vendorId);
    return { deleted: true };
  }

  // The vendor's own reply to a review left on its profile — deliberately
  // not the reviewer editing anything, this is the other side of the
  // conversation. Vendor-initiated (/vendors/me/...), so it checks a
  // Vendor.accountId match itself rather than leaning on :projectId ABAC.
  // One reply per review: a second call overwrites the first rather than
  // threading, matching the reviews model's "one review per project"
  // simplicity elsewhere in this module.
  async replyToReview(vendorAccountId: string, reviewId: string, dto: ReplyToReviewDto) {
    const vendor = await this.prisma.vendor.findUnique({ where: { accountId: vendorAccountId } });
    if (!vendor) throw new NotFoundException('Review not found');
    const review = await this.prisma.vendorReview.findUnique({ where: { id: reviewId } });
    if (!review || review.vendorId !== vendor.id) throw new NotFoundException('Review not found');
    return this.prisma.vendorReview.update({
      where: { id: reviewId },
      data: { response: dto.response, respondedAt: new Date() },
    });
  }

  // Closes the "no report/flag mechanism" gap the README flagged — the
  // reviewed vendor's own report that a review is spam/abusive/inaccurate,
  // gated on the same review:respond-shaped permission as replying (this
  // is still just the other party to the review acting on their own
  // profile). Flagging doesn't hide the review itself — only
  // moderateReview below does that — it just surfaces it to the neutral
  // reviewer queue. A review that's already hidden can't be re-flagged;
  // one already flagged can be re-flagged with a new reason (overwrites,
  // same one-shot-per-field shape as response/reply).
  async flagReview(vendorAccountId: string, reviewId: string, dto: FlagReviewDto) {
    const vendor = await this.prisma.vendor.findUnique({ where: { accountId: vendorAccountId } });
    if (!vendor) throw new NotFoundException('Review not found');
    const review = await this.prisma.vendorReview.findUnique({ where: { id: reviewId } });
    if (!review || review.vendorId !== vendor.id) throw new NotFoundException('Review not found');
    if (review.moderationStatus === 'hidden') {
      throw new BadRequestException('This review has already been hidden by a moderator');
    }
    return this.prisma.vendorReview.update({
      where: { id: reviewId },
      data: { moderationStatus: 'flagged', flagReason: dto.reason, flaggedAt: new Date() },
    });
  }

  // The neutral-reviewer queue this flag feeds — same "no :vendorId param
  // for PermissionsGuard's ABAC to key on" shape as setVerificationStatus,
  // so review:moderate reaches every flagged review on the platform, not
  // just one vendor's.
  findFlaggedReviews() {
    return this.prisma.vendorReview.findMany({
      where: { moderationStatus: 'flagged' },
      include: { vendor: { select: { id: true, businessName: true } } },
      orderBy: { flaggedAt: 'desc' },
    });
  }

  // review:moderate's actual decision: hide the review (excluded from the
  // vendor's public profile — see findOne/findForAccount) or (re)publish
  // it. Blocks only from "published" — nothing has ever been reported, so
  // there's nothing to decide. Both "flagged" and "hidden" are valid
  // starting points so a moderator can reverse an earlier hide as well as
  // act on a fresh flag — findFlaggedReviews only ever surfaces the
  // "flagged" ones, but this itself doesn't require the review still be
  // in the queue, the same way DocumentsService.arbitrateVerify isn't
  // limited to documents findPendingForArbitration still lists.
  async moderateReview(reviewId: string, dto: ModerateReviewDto) {
    const review = await this.prisma.vendorReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Review not found');
    if (review.moderationStatus === 'published') {
      throw new BadRequestException('This review has never been flagged — nothing to moderate');
    }
    const updated = await this.prisma.vendorReview.update({
      where: { id: reviewId },
      data: { moderationStatus: dto.status, moderationNotes: dto.moderationNotes, moderatedAt: new Date() },
    });
    // Recompute whenever the hidden set changes in either direction —
    // hiding it, or restoring a previously hidden one back to published.
    if (dto.status === 'hidden' || review.moderationStatus === 'hidden') {
      await this.recomputeRating(review.vendorId);
    }
    return updated;
  }
}
