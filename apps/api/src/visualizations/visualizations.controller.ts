import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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
  // record scoped to the property, not just a read. Security fix:
  // OpenAI's Images API has no sandbox mode (see .env.example's own
  // comment) — every call here is real, billed money, so it gets the
  // same tighter-than-default throttle the AI action endpoints do.
  @RequirePermissions('property:write')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
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
