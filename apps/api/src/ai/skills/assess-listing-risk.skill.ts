import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';
import { DEFAULT_DOCUMENT_CHECKLIST, labelDocumentType } from './document-checklists';

const PRICE_DEVIATION_THRESHOLD = 0.4; // 40% either side of the platform's own estimated value

// Module 5/6's "chat to explain why a listing carries a particular
// verification or risk status" — deliberately buyer-facing, unlike
// generate_listing_description: this does NOT filter by ctx.accountId, the
// same way GET /listings/:id doesn't. Anyone who can browse the
// marketplace can ask why a listing looks risky; that's the whole point of
// a public risk signal. It never confirms ownership or fraud itself
// (Module 6's actual verification workflow isn't built) — it only points
// out what a human should look at more closely.
export const assessListingRiskSkill: AiSkill = {
  key: 'assess_listing_risk',
  label: 'Assess listing risk',
  requiredPermission: 'listing:read',
  moduleContextPrefix: 'listing',
  inputSchema: NO_INPUT_SCHEMA,

  async run(_ctx, moduleContext, _input, { prisma, llm }) {
    const listingId = moduleContext.split(':')[1];
    const listing = await prisma.propertyListing.findUnique({
      where: { id: listingId },
      include: { property: { include: { documents: true } } },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    const flags: string[] = [];

    if (listing.verificationStatus !== 'verified') {
      flags.push(`Listing verification status is "${listing.verificationStatus}", not verified`);
    }
    if (listing.status !== 'active') {
      flags.push(`Listing status is "${listing.status}" — no longer an open listing`);
    }
    if (listing.photoUrls.length === 0) {
      flags.push('No photos attached');
    }

    const documentTypes = new Set(listing.property.documents.map((d: { documentType: string }) => d.documentType));
    for (const required of DEFAULT_DOCUMENT_CHECKLIST) {
      if (!documentTypes.has(required)) {
        flags.push(`Underlying property is missing ${labelDocumentType(required)}`);
      }
    }

    const estimatedValue = listing.property.estimatedValue != null ? Number(listing.property.estimatedValue) : null;
    if (estimatedValue != null && estimatedValue > 0) {
      const deviation = Math.abs(Number(listing.askingPrice) - estimatedValue) / estimatedValue;
      if (deviation > PRICE_DEVIATION_THRESHOLD) {
        const direction = Number(listing.askingPrice) > estimatedValue ? 'above' : 'below';
        flags.push(
          `Asking price is more than ${(PRICE_DEVIATION_THRESHOLD * 100).toFixed(0)}% ${direction} the platform's own estimated value for this property`,
        );
      }
    }

    const summary = await llm.complete({
      systemPrompt:
        "You explain a property listing's risk factors to a prospective buyer in one short, plain-language paragraph. Be factual and neutral, never alarmist, and never claim to confirm or deny fraud.",
      userPrompt:
        flags.length === 0
          ? `Listing "${listing.title}" has no flagged risk factors from the platform's own checks.`
          : `Listing "${listing.title}" has these flagged risk factors: ${flags.join('; ')}.`,
    });

    return {
      draftLabel: 'Listing risk assessment — draft',
      items: [summary, ...(flags.length ? flags : ["No risk factors flagged by the platform's own checks."])],
      warn: flags.length > 0,
    };
  },
};
