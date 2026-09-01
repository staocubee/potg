import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember } from '../common/decorators/current-user.decorator';
import { ListingsService } from './listings.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { CreateInquiryDto } from './dto/create-inquiry.dto';
import { CreateOfferDto } from './dto/create-offer.dto';
import { RespondOfferDto } from './dto/respond-offer.dto';
import { SearchListingsQuery } from './dto/search-listings.dto';

type AccountMemberCtx = { accountId: string };

// No :propertyId route param here (a listing has its own :listingId), so
// PermissionsGuard's ABAC check never triggers on this controller —
// ownership of a specific listing is checked in ListingsService instead,
// the same pattern VendorsController uses for its "me" routes.
@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller('listings')
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @RequirePermissions('listing:write')
  @Post()
  create(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: CreateListingDto) {
    return this.listings.create(member.accountId, dto);
  }

  // Public marketplace browse/search (Priority 5's "search" requirement).
  @RequirePermissions('listing:read')
  @Get()
  findAll(@Query() query: SearchListingsQuery) {
    return this.listings.findAll(query);
  }

  @RequirePermissions('listing:read')
  @Get('me')
  findMine(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.listings.findMine(member.accountId);
  }

  @RequirePermissions('offer:read')
  @Get('me/offers')
  myOffers(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.listings.myOffers(member.accountId);
  }

  @RequirePermissions('listing:read')
  @Get('me/favorites')
  myFavorites(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.listings.myFavorites(member.accountId);
  }

  @RequirePermissions('listing:read')
  @Get(':listingId')
  findOne(@Param('listingId') listingId: string, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.listings.findOne(listingId, member.accountId);
  }

  @RequirePermissions('listing:write')
  @Post(':listingId/publish')
  publish(@Param('listingId') listingId: string, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.listings.publish(listingId, member.accountId);
  }

  // Buyer-initiated — any account with listing:read can express interest.
  @RequirePermissions('listing:read')
  @Post(':listingId/inquiries')
  createInquiry(
    @Param('listingId') listingId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: CreateInquiryDto,
  ) {
    return this.listings.createInquiry(listingId, member.accountId, dto);
  }

  @RequirePermissions('listing:write')
  @Get(':listingId/inquiries')
  findInquiries(@Param('listingId') listingId: string, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.listings.findInquiries(listingId, member.accountId);
  }

  @RequirePermissions('offer:write')
  @Post(':listingId/offers')
  createOffer(
    @Param('listingId') listingId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: CreateOfferDto,
  ) {
    return this.listings.createOffer(listingId, member.accountId, dto);
  }

  @RequirePermissions('offer:read')
  @Get(':listingId/offers')
  findOffers(@Param('listingId') listingId: string, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.listings.findOffers(listingId, member.accountId);
  }

  @RequirePermissions('offer:write')
  @Post(':listingId/offers/:offerId/respond')
  respondToOffer(
    @Param('listingId') listingId: string,
    @Param('offerId') offerId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: RespondOfferDto,
  ) {
    return this.listings.respondToOffer(listingId, offerId, member.accountId, dto);
  }

  @RequirePermissions('listing:read')
  @Post(':listingId/favorites')
  favorite(@Param('listingId') listingId: string, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.listings.favorite(listingId, member.accountId);
  }

  @RequirePermissions('listing:read')
  @Delete(':listingId/favorites')
  unfavorite(@Param('listingId') listingId: string, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.listings.unfavorite(listingId, member.accountId);
  }
}
