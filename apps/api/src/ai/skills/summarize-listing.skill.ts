import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';

// The seller's own "how is my listing doing" view — deliberately the
// owner-only counterpart to assess_listing_risk, not a replacement for
// it. assess_listing_risk is public/buyer-facing by design (same "no
// accountId filter" reach GET /listings/:id itself has — its own comment
// explains why); this is the opposite on purpose, filtered to
// ctx.accountId the same way summarize_property/summarize_project are,
// because engagement numbers (inquiry/offer counts, a competing offer's
// amount) are exactly the kind of thing a seller wouldn't want a random
// buyer asking a chatbot to see.
export const summarizeListingSkill: AiSkill = {
  key: 'summarize_listing',
  label: 'Summarize this listing',
  requiredPermission: 'listing:read',
  moduleContextPrefix: 'listing',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma, llm }) {
    const listingId = moduleContext.split(':')[1];
    const listing = await prisma.propertyListing.findFirst({
      where: { id: listingId, accountId: ctx.accountId },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    const [inquiries, offers, favoriteCount] = await Promise.all([
      prisma.listingInquiry.findMany({ where: { listingId } }),
      prisma.listingOffer.findMany({ where: { listingId } }),
      prisma.listingFavorite.count({ where: { listingId } }),
    ]);

    const daysOnMarket = Math.max(0, Math.floor((Date.now() - listing.createdAt.getTime()) / (1000 * 60 * 60 * 24)));
    const newInquiries = inquiries.filter((i: { status: string }) => i.status === 'new').length;
    const openOffers = offers.filter((o: { status: string }) => o.status === 'submitted' || o.status === 'countered');
    const acceptedOffer = offers.find((o: { status: string }) => o.status === 'accepted');
    const highestOffer = offers.length
      ? Math.max(...offers.map((o: { amount: unknown }) => Number(o.amount)))
      : null;

    const items: string[] = [];
    items.push(`${listing.viewCount} view(s), ${favoriteCount} save(s), ${daysOnMarket} day(s) on market`);
    items.push(inquiries.length ? `${inquiries.length} inquirie(s), ${newInquiries} not yet responded to` : 'No inquiries yet');
    items.push(
      offers.length
        ? `${offers.length} offer(s)${openOffers.length ? `, ${openOffers.length} awaiting a response` : ''}${
            highestOffer != null ? `, highest so far ${highestOffer.toLocaleString()} ${listing.currency}` : ''
          }`
        : 'No offers yet',
    );
    if (acceptedOffer) {
      items.push(`An offer of ${Number(acceptedOffer.amount).toLocaleString()} ${acceptedOffer.currency} has been accepted`);
    }

    const intro = await llm.complete({
      systemPrompt:
        'You summarize a property listing\'s market performance for its seller in one plain, factual sentence — call out anything worth acting on (an unanswered offer, no engagement at all) rather than only good news.',
      userPrompt: `Listing "${listing.title}" (${listing.listingType}), status ${listing.status}, asking ${Number(listing.askingPrice).toLocaleString()} ${listing.currency}. ${items.join('. ')}.`,
    });

    return {
      draftLabel: 'Listing summary — draft',
      items: [intro, ...items],
      warn: openOffers.length > 0 && !acceptedOffer,
    };
  },
};
