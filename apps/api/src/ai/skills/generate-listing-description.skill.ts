import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

// Module 5's "AI listing description generator from photos and property
// data" — the first new moduleContextPrefix outside "property"/"project":
// moduleContext here is "listing:<uuid>". Same split as summarize_property:
// every fact (property type, location, price, photo count) comes straight
// from the database; the LLM only writes the marketing paragraph around
// them, so a stubbed provider still returns something factually grounded.
export const generateListingDescriptionSkill: AiSkill = {
  key: 'generate_listing_description',
  label: 'Generate a listing description',
  requiredPermission: 'listing:write',
  moduleContextPrefix: 'listing',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma, llm }) {
    const listingId = moduleContext.split(':')[1];
    const listing = await prisma.propertyListing.findFirst({
      where: { id: listingId, accountId: ctx.accountId },
      include: { property: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    const { property } = listing;
    const location = [property.city, property.country].filter(Boolean).join(', ');
    const draft = await llm.complete({
      systemPrompt:
        'You write a short, appealing property listing description (2-3 sentences) from the facts given. No invented amenities or details beyond what is provided, no hedging.',
      userPrompt: `${listing.listingType === 'sale' ? 'For sale' : listing.listingType === 'rent' ? 'For rent' : 'Short let'}: a ${property.propertyType.replace(/_/g, ' ')} in ${location}. Asking ${Number(listing.askingPrice).toLocaleString()} ${listing.currency}. ${listing.photoUrls.length} photo(s) attached. Title given by the owner: "${listing.title}".`,
    });

    return {
      draftLabel: 'Listing description — draft',
      items: [
        draft,
        `${property.propertyType.replace(/_/g, ' ')} — ${location}`,
        `Asking ${Number(listing.askingPrice).toLocaleString()} ${listing.currency} (${listing.listingType})`,
        `${listing.photoUrls.length} photo(s) attached`,
      ],
      warn: listing.photoUrls.length === 0,
    };
  },
};
