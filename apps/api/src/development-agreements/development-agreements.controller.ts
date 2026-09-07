import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember, CurrentUser } from '../common/decorators/current-user.decorator';
import { DevelopmentAgreementsService } from './development-agreements.service';
import { CreateDevelopmentAgreementDto } from './dto/create-development-agreement.dto';

type AccountMemberCtx = { accountId: string };
type UserCtx = { id: string };

// The owner side — nested under /properties/:propertyId, same reasoning
// PropertiesController's own access-grants/devices/tour-assets routes
// already give for living alongside a property's other nested resources.
// property:write to propose/cancel, property:read to list — same tier
// PropertyAccessGrant already uses.
@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller('properties/:propertyId/development-agreements')
export class DevelopmentAgreementsController {
  constructor(private readonly agreements: DevelopmentAgreementsService) {}

  @RequirePermissions('property:write')
  @Post()
  propose(
    @Param('propertyId') propertyId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @CurrentUser() user: UserCtx,
    @Body() dto: CreateDevelopmentAgreementDto,
  ) {
    return this.agreements.propose(propertyId, member.accountId, user.id, dto);
  }

  @RequirePermissions('property:read')
  @Get()
  findForProperty(@Param('propertyId') propertyId: string) {
    return this.agreements.findForProperty(propertyId);
  }

  @RequirePermissions('property:write')
  @Delete(':agreementId')
  cancel(@Param('propertyId') propertyId: string, @Param('agreementId') agreementId: string) {
    return this.agreements.cancel(propertyId, agreementId);
  }
}
