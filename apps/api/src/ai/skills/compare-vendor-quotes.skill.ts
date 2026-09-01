import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

// Module 9's vendor quote comparison, and the wireframe's "Compare quotes"
// quick action on RenovationProject. Deterministic sort + a spread check —
// no LLM needed, and nothing here should be read as a recommendation of
// which vendor to hire; it's the same comparison a human would do by eye,
// just done for them.
//
// Reads VendorReview (via Vendor.reviews/_count, not just the pre-computed
// Vendor.ratingAverage) — the gap flagged since the reviews pass: this was
// the one skill already showing a vendor's rating without ever having
// looked at an actual review. Now every line says how many reviews that
// rating rests on (a 5.0 from one review reads very differently from a 4.6
// from twenty), and the lowest-priced quote gets an explicit reputation
// caution when it's unreviewed or poorly rated — the case where "cheapest"
// and "worth a second look" both apply at once.
export const compareVendorQuotesSkill: AiSkill = {
  key: 'compare_vendor_quotes',
  label: 'Compare vendor quotes',
  requiredPermission: 'quote:read',
  moduleContextPrefix: 'project',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma }) {
    const projectId = moduleContext.split(':')[1];
    const project = await prisma.project.findFirst({
      where: { id: projectId, accountId: ctx.accountId },
    });
    if (!project) throw new NotFoundException('Project not found');

    const quotes = await prisma.vendorQuote.findMany({
      where: { projectId, status: { in: ['submitted', 'accepted'] } },
      include: {
        vendor: {
          include: {
            reviews: { orderBy: { createdAt: 'desc' }, take: 1 },
            _count: { select: { reviews: true } },
          },
        },
      },
      orderBy: { amount: 'asc' },
    });
    if (quotes.length === 0) {
      throw new BadRequestException('No submitted quotes on this project yet');
    }

    type VendorWithReviews = {
      businessName: string;
      ratingAverage: unknown;
      reviews: { comment: string | null }[];
      _count: { reviews: number };
    };
    type QuoteWithVendor = { amount: unknown; currency: string; status: string; vendor: VendorWithReviews };

    const reputationText = (vendor: VendorWithReviews) => {
      const count = vendor._count.reviews;
      if (vendor.ratingAverage == null || count === 0) return 'no reviews yet';
      return `rated ${Number(vendor.ratingAverage).toFixed(1)} across ${count} review${count === 1 ? '' : 's'}`;
    };

    const amounts = quotes.map((q: { amount: unknown }) => Number(q.amount));
    const lowest = amounts[0];
    const highest = amounts[amounts.length - 1];
    const spreadPct = lowest > 0 ? ((highest - lowest) / lowest) * 100 : 0;

    const items = (quotes as QuoteWithVendor[]).map(
      (q) =>
        `${q.vendor.businessName} — ${Number(q.amount).toLocaleString()} ${q.currency} (${reputationText(q.vendor)})` +
        (q.status === 'accepted' ? ' — accepted' : ''),
    );
    items.push(`Lowest: ${lowest.toLocaleString()} · Highest: ${highest.toLocaleString()} · Spread: ${spreadPct.toFixed(0)}%`);

    let warn = spreadPct > 50;
    if (warn) {
      items.push('Quotes vary by more than 50% — worth checking whether they cover the same scope before deciding.');
    }

    const cheapest = (quotes as QuoteWithVendor[])[0].vendor;
    const cheapestReviewCount = cheapest._count.reviews;
    if (cheapestReviewCount === 0) {
      items.push(`The lowest quote is from ${cheapest.businessName}, which has no reviews yet — worth extra diligence before accepting on price alone.`);
      warn = true;
    } else if (cheapest.ratingAverage != null && Number(cheapest.ratingAverage) < 3) {
      items.push(
        `The lowest quote is from ${cheapest.businessName}, rated ${Number(cheapest.ratingAverage).toFixed(1)} — worth reading its reviews before accepting on price alone.`,
      );
      warn = true;
    } else if (cheapest.reviews[0]?.comment) {
      items.push(`Most recent review of ${cheapest.businessName}: "${cheapest.reviews[0].comment}"`);
    }

    return {
      draftLabel: 'Vendor quote comparison — draft',
      items,
      warn,
    };
  },
};
