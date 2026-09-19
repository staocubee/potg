import { Module } from '@nestjs/common';
import { ListingsModule } from '../listings/listings.module';
import { VendorsModule } from '../vendors/vendors.module';
import { MaterialsModule } from '../materials/materials.module';
import { PublicProfilesService } from './public-profiles.service';
import { PublicProfilesController } from './public-profiles.controller';
import { PublicMarketplaceController } from './public-marketplace.controller';

@Module({
  imports: [ListingsModule, VendorsModule, MaterialsModule],
  providers: [PublicProfilesService],
  controllers: [PublicProfilesController, PublicMarketplaceController],
})
export class PublicProfilesModule {}
