import { Module } from '@nestjs/common';
import { CommunitiesService } from './communities.service';
import { CommunitiesController } from './communities.controller';

// Module 17 (Estate and Community Management), Phase 1 — real scope
// supplied by the user for this pass, unlike the rest of the 16-24
// bucket. See schema.prisma's own "Module 17" section comment for the
// full reasoning behind what's built now (Communities, Residents,
// Community Announcements) versus deferred (service charge/estate dues,
// visitor access requests, facility booking, complaint management,
// security notices, community polls/voting, estate reports).
@Module({
  providers: [CommunitiesService],
  controllers: [CommunitiesController],
})
export class CommunitiesModule {}
