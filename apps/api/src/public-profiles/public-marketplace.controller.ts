import { Controller, Get } from '@nestjs/common';
import { PublicProfilesService } from './public-profiles.service';

// The landing page's own public data source — same "no @UseGuards at
// all" shape PublicProfilesController already uses. See
// PublicProfilesService.getMarketplaceHighlights for why this is a
// hand-picked teaser, not the full authenticated marketplace browse.
@Controller('public/marketplace')
export class PublicMarketplaceController {
  constructor(private readonly publicProfiles: PublicProfilesService) {}

  @Get('highlights')
  getHighlights() {
    return this.publicProfiles.getMarketplaceHighlights();
  }
}
