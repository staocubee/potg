import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';
import { matchScopeItems } from './cost-estimates';

// Module 10's "turn a BOQ line item directly into a shopping list or bulk
// quote request" — reuses estimate_project_budget's keyword matcher
// (cost-estimates.ts) against the same scope description, then looks each
// matched item up against the real Product catalog instead of the
// placeholder cost table. This only ever drafts a suggestion — creating the
// actual order stays a separate, deliberate POST /orders call by a human,
// same human-in-the-loop rule as every other skill.
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

    const matched = matchScopeItems(project.scopeDescription);
    if (matched.length === 0) {
      return {
        draftLabel: 'Materials order draft',
        items: ["Couldn't match any recognized scope items in the description."],
        warn: true,
      };
    }

    type SupplierWithReviews = { businessName: string; ratingAverage: unknown; _count: { reviews: number } };
    type ProductWithSupplier = { name: string; unitPrice: unknown; currency: string; unit: string; supplier: SupplierWithReviews };

    const reputationText = (supplier: SupplierWithReviews) => {
      const count = supplier._count.reviews;
      if (supplier.ratingAverage == null || count === 0) return 'no reviews yet';
      return `rated ${Number(supplier.ratingAverage).toFixed(1)} (${count} review${count === 1 ? '' : 's'})`;
    };

    const items: string[] = [];
    let anyUnmatched = false;
    let anyUnreviewedCheapest = false;
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
      if (products.length === 0) {
        items.push(`${scopeItem.label} — no matching product in the catalog yet`);
        anyUnmatched = true;
      } else {
        const cheapest = products[0] as ProductWithSupplier;
        items.push(
          `${scopeItem.label} — ${products.length} product(s) found, cheapest: ${cheapest.name} at ` +
            `${Number(cheapest.unitPrice).toLocaleString()} ${cheapest.currency}/${cheapest.unit} — ` +
            `supplier ${cheapest.supplier.businessName} (${reputationText(cheapest.supplier)})`,
        );
        if (cheapest.supplier._count.reviews === 0) anyUnreviewedCheapest = true;
      }
    }
    items.push("Quantities aren't estimated here — confirm amounts before placing an order with POST /orders.");
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
