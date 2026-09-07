import { Controller, Get, Param } from '@nestjs/common';
import { PublicProfilesService } from './public-profiles.service';

// Deliberately no @UseGuards at all — this is the actual public "one
// page website," reachable by anyone with the link, no access_token
// cookie required. See PublicProfilesService's own comment on why that
// raises the bar on what this is allowed to return, and why its own
// hand-picked field lists exist instead of reusing an authenticated
// service's return shape directly.
@Controller('public/accounts')
export class PublicProfilesController {
  constructor(private readonly publicProfiles: PublicProfilesService) {}

  @Get(':accountId')
  getProfile(@Param('accountId') accountId: string) {
    return this.publicProfiles.getProfile(accountId);
  }
}
