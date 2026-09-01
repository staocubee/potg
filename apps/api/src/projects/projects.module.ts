import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { VendorsModule } from '../vendors/vendors.module';

// VendorsModule is imported (not just VendorsService injected some other
// way) so ProjectsController can call VendorsService.createReview directly
// — the review-write route lives here rather than on VendorsController so
// it inherits PermissionsGuard's :projectId ABAC check for free. See the
// comment on VendorsService.createReview for the full reasoning.
@Module({
  imports: [VendorsModule],
  providers: [ProjectsService],
  controllers: [ProjectsController],
  exports: [ProjectsService],
})
export class ProjectsModule {}
