import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { VendorsModule } from '../vendors/vendors.module';
import { NotificationsModule } from '../notifications/notifications.module';

// VendorsModule is imported (not just VendorsService injected some other
// way) so ProjectsController can call VendorsService.createReview directly
// — the review-write route lives here rather than on VendorsController so
// it inherits PermissionsGuard's :projectId ABAC check for free. See the
// comment on VendorsService.createReview for the full reasoning.
// NotificationsModule — Module 19 Phase 1's own real-time trigger for
// project updates (see ProjectsService.addUpdate's own comment).
@Module({
  imports: [VendorsModule, NotificationsModule],
  providers: [ProjectsService],
  controllers: [ProjectsController],
  exports: [ProjectsService],
})
export class ProjectsModule {}
