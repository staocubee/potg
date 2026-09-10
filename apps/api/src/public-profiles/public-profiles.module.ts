import { Module } from '@nestjs/common';
import { ListingsModule } from '../listings/listings.module';
import { PublicProfilesService } from './public-profiles.service';
import { PublicProfilesController } from './public-profiles.controller';
import { PublicMarketplaceController } from './public-marketplace.controller';

@Module({
  imports: [ListingsModule],
  providers: [PublicProfilesService],
  controllers: [PublicProfilesController, PublicMarketplaceController],
})
export class PublicProfilesModule {}
