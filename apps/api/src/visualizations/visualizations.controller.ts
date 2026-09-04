import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { VisualizationsService } from './visualizations.service';
import { CreateVisualizationDto } from './dto/create-visualization.dto';

type UserCtx = { id: string };

// Nested under /visualizations/property/:propertyId, same reasoning
// DocumentsController's own comment gives for its identical shape — so
// PropertiesModule and this module stay independent of each other;
// PermissionsGuard's ABAC still keys on the :propertyId param regardless
// of which controller it appears on.
@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller('visualizations')
export class VisualizationsController {
  constructor(private readonly visualizations: VisualizationsService) {}

  // property:write — same tier addValuation already sits at, a new
  // record scoped to the property, not just a read.
  @RequirePermissions('property:write')
  @Post('property/:propertyId')
  create(@Param('propertyId') propertyId: string, @CurrentUser() user: UserCtx, @Body() dto: CreateVisualizationDto) {
    return this.visualizations.create(propertyId, user.id, dto);
  }

  @RequirePermissions('property:read')
  @Get('property/:propertyId')
  findForProperty(@Param('propertyId') propertyId: string) {
    return this.visualizations.findForProperty(propertyId);
  }
}
