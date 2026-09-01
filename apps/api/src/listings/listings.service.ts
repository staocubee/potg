import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { CreateInquiryDto } from './dto/create-inquiry.dto';
import { CreateOfferDto } from './dto/create-offer.dto';
import { RespondOfferDto } from './dto/respond-offer.dto';
import { SearchListingsQuery } from './dto/search-listings.dto';

@Injectable()
export class ListingsService {
  constructor(private readonly prisma: PrismaService) {}

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
  findAll(query: SearchListingsQuery) {
    const minPrice = query.minPrice ? Number(query.minPrice) : undefined;
    const maxPrice = query.maxPrice ? Number(query.maxPrice) : undefined;
    return this.prisma.propertyListing.findMany({
      where: {
        status: 'active',
        listingType: query.listingType,
        property: {
          propertyType: query.propertyType,
          city: query.city ? { equals: query.city, mode: 'insensitive' } : undefined,
        },
        askingPrice:
          minPrice != null || maxPrice != null
            ? { gte: minPrice, lte: maxPrice }
            : undefined,
      },
      include: { property: { select: { propertyType: true, city: true, country: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  findMine(accountId: string) {
    return this.prisma.propertyListing.findMany({
      where: { accountId },
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

  async publish(listingId: string, accountId: string) {
    const listing = await this.requireOwnListing(listingId, accountId);
    if (listing.status !== 'draft') {
      throw new BadRequestException(`Cannot publish a listing that is already "${listing.status}"`);
    }
    return this.prisma.propertyListing.update({ where: { id: listingId }, data: { status: 'active' } });
  }

  // Buyer-initiated — deliberately not ownership-gated, unlike most of this
  // service's other methods.
  createInquiry(listingId: string, accountId: string, dto: CreateInquiryDto) {
    return this.prisma.listingInquiry.create({
      data: { listingId, accountId, ...dto },
    });
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

  myOffers(accountId: string) {
    return this.prisma.listingOffer.findMany({
      where: { accountId },
      include: { listing: { select: { id: true, title: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async respondToOffer(listingId: string, offerId: string, accountId: string, dto: RespondOfferDto) {
    await this.requireOwnListing(listingId, accountId);
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
      await this.prisma.propertyListing.update({ where: { id: listingId }, data: { status: 'under_offer' } });
    }
    return updated;
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
