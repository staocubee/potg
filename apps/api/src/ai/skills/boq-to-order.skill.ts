import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';
import { matchScopeItems } from './cost-estimates';
import { PrismaService } from '../../prisma/prisma.service';

type SupplierWithReviews = { businessName: string; ratingAverage: unknown; _count: { reviews: number } };
type ProductWithSupplier = { id: string; name: string; unitPrice: unknown; currency: string; unit: string; supplier: SupplierWithReviews };

// Shared by run() below (to build the human-readable draft) and
// AiService.applyChainedAction (to know exactly which real products
// Accept should add to the cart) — re-deriving the same real query both
// places rather than smuggling product ids through the draft's own
// text items, which are meant to be read, not parsed.
export async function findCheapestMatchedProducts(prisma: PrismaService, scopeDescription: string) {
  const matched = matchScopeItems(scopeDescription);
  const results: { keyword: string; label: string; product: ProductWithSupplier | null; matchCount: number }[] = [];
  for (const scopeItem of matched) {
    const products = await prisma.product.findMany({
      where: { status: 'active', category: { contains: scopeItem.keyword, mode: 'insensitive' } },
      orderBy: { unitPrice: 'asc' },
      take: 3,
      include: {
        // Excludes a moderator-hidden review — see the same exclusion
        // in compare-vendor-quotes.skill.ts and MaterialsService.recomputeRating.
        supplier: {
          select: {
            businessName: true,
            ratingAverage: true,
            _count: { select: { reviews: { where: { moderationStatus: { not: 'hidden' } } } } },
          },
        },
      },
    });
    results.push({
      keyword: scopeItem.keyword,
      label: scopeItem.label,
      product: (products[0] as ProductWithSupplier) ?? null,
      matchCount: products.length,
    });
  }
  return results;
}

// Module 10's "turn a BOQ line item directly into a shopping list or bulk
// quote request" — reuses estimate_project_budget's keyword matcher
// (cost-estimates.ts) against the same scope description, then looks each
// matched item up against the real Product catalog instead of the
// placeholder cost table.
//
// The audit's own finding on Workflow 6: "'Imports from BOQ' is not a
// marketplace feature — boq_to_order only drafts a text list via the AI
// side panel; nothing writes to a cart or order." Accept now really does
// import it — AiService.applyChainedAction adds each matched item's
// cheapest product to the real cart, same human-in-the-loop rule every
// other chained skill already follows (nothing happens until a human
// decides). Deliberately still not a real per-item quantity estimate —
// see the audit's own separate "no quantities" finding on Workflow 4,
// which this doesn't close: 1 unit per item is a real, honest starting
// point a buyer adjusts in their own cart, not a guessed number dressed
// up as one.
//
// Reads SupplierReview (via Supplier.ratingAverage/_count) — the materials
// marketplace's counterpart to what compare_vendor_quotes now does for
// vendors. "Cheapest" used to be the only signal this skill surfaced; a
// cheapest product from an unreviewed or poorly-rated supplier now says so,
// rather than presenting price as the only thing worth knowing.
export const boqToOrderSkill: AiSkill = {
  key: 'boq_to_order',
  label: 'Turn scope into a materials order draft',
  requiredPermission: 'project:read',
  moduleContextPrefix: 'project',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma }) {
    const projectId = moduleContext.split(':')[1];
    const project = await prisma.project.findFirst({
      where: { id: projectId, accountId: ctx.accountId },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.scopeDescription) {
      throw new BadRequestException('This project has no scope description to draft an order from yet');
    }

    const matches = await findCheapestMatchedProducts(prisma, project.scopeDescription);
    if (matches.length === 0) {
      return {
        draftLabel: 'Materials order draft',
        items: ["Couldn't match any recognized scope items in the description."],
        warn: true,
      };
    }

    const reputationText = (supplier: SupplierWithReviews) => {
      const count = supplier._count.reviews;
      if (supplier.ratingAverage == null || count === 0) return 'no reviews yet';
      return `rated ${Number(supplier.ratingAverage).toFixed(1)} (${count} review${count === 1 ? '' : 's'})`;
    };

    const items: string[] = [];
    let anyUnmatched = false;
    let anyUnreviewedCheapest = false;
    let anyAddable = false;
    for (const match of matches) {
      if (!match.product) {
        items.push(`${match.label} — no matching product in the catalog yet`);
        anyUnmatched = true;
      } else {
        const { product } = match;
        items.push(
          `${match.label} — ${match.matchCount} product(s) found, cheapest: ${product.name} at ` +
            `${Number(product.unitPrice).toLocaleString()} ${product.currency}/${product.unit} — ` +
            `supplier ${product.supplier.businessName} (${reputationText(product.supplier)})`,
        );
        if (product.supplier._count.reviews === 0) anyUnreviewedCheapest = true;
        anyAddable = true;
      }
    }
    if (anyAddable) {
      items.push('Accepting this draft adds 1 unit of each matched product above to your cart — adjust exact quantities before ordering.');
    }
    if (anyUnreviewedCheapest) {
      items.push('At least one cheapest pick above comes from a supplier with no reviews yet — worth a second look before ordering on price alone.');
    }

    return {
      draftLabel: 'Materials order draft',
      items,
      warn: anyUnmatched || anyUnreviewedCheapest,
    };
  },
};
