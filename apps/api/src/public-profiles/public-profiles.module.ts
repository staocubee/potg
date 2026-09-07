import { Module } from '@nestjs/common';
import { ListingsModule } from '../listings/listings.module';
import { PublicProfilesService } from './public-profiles.service';
import { PublicProfilesController } from './public-profiles.controller';

@Module({
  imports: [ListingsModule],
  providers: [PublicProfilesService],
  controllers: [PublicProfilesController],
})
export class PublicProfilesModule {}
