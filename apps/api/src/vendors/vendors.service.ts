import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { SubmitQuoteDto } from './dto/submit-quote.dto';
import { CreateVendorReviewDto } from './dto/create-vendor-review.dto';
import { UpdateVendorReviewDto } from './dto/update-vendor-review.dto';
import { ReplyToReviewDto } from './dto/reply-to-review.dto';
import { FlagReviewDto } from './dto/flag-review.dto';
import { ModerateReviewDto } from './dto/moderate-review.dto';
import { SetVendorVerificationDto } from './dto/set-vendor-verification.dto';
import { SubmitVendorTrustAuditDto } from './dto/submit-vendor-trust-audit.dto';
import { SetVendorBankDetailsDto } from './dto/set-vendor-bank-details.dto';
import { SetPaypalPayoutEmailDto } from './dto/set-paypal-payout-email.dto';
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
  findAll(serviceCategory?: string) {
    return this.prisma.vendor.findMany({
      where: serviceCategory ? { serviceCategory } : undefined,
      orderBy: [{ ratingAverage: 'desc' }, { createdAt: 'desc' }],
    });
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
