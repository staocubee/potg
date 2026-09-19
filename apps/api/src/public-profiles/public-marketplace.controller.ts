import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { PublicProfilesService } from './public-profiles.service';
import { SearchListingsQuery } from '../listings/dto/search-listings.dto';

// The landing page's own public data source, and (since this pass) the
// actual guest-facing browse/detail surface — same "no @UseGuards at
// all" shape PublicProfilesController already uses. See
// PublicProfilesService's own comments for why each route is safe to
// expose with no credential at all.
@Controller('public/marketplace')
export class PublicMarketplaceController {
  constructor(private readonly publicProfiles: PublicProfilesService) {}

  @Get('highlights')
  getHighlights() {
    return this.publicProfiles.getMarketplaceHighlights();
  }

  @Get('listings')
  getListings(@Query() query: SearchListingsQuery) {
    return this.publicProfiles.getPublicListings(query);
  }

  @Get('listings/:listingId')
  async getListing(@Param('listingId') listingId: string) {
    const listing = await this.publicProfiles.getPublicListing(listingId);
    if (!listing) throw new NotFoundException('Listing not found');
    return listing;
  }

  @Get('vendors')
  getVendors(
    @Query('serviceCategory') serviceCategory?: string,
    @Query('q') q?: string,
    @Query('location') location?: string,
    @Query('minRating') minRating?: string,
    @Query('verificationStatus') verificationStatus?: string,
  ) {
    return this.publicProfiles.getPublicVendors(serviceCategory, q, location, minRating, verificationStatus);
  }

  @Get('vendors/:vendorId')
  async getVendor(@Param('vendorId') vendorId: string) {
    const vendor = await this.publicProfiles.getPublicVendor(vendorId);
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  @Get('products')
  getProducts(@Query('category') category?: string, @Query('q') q?: string) {
    return this.publicProfiles.getPublicProducts(category, q);
  }

  @Get('suppliers/:supplierId')
  async getSupplier(@Param('supplierId') supplierId: string) {
    const supplier = await this.publicProfiles.getPublicSupplier(supplierId);
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }
}
