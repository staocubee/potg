import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { ComplianceService } from './compliance.service';
import { CreateComplianceItemDto } from './dto/create-compliance-item.dto';
import { UpdateComplianceItemDto } from './dto/update-compliance-item.dto';

// Platform-wide, like the vendor:verify/dispute:arbitrate/document:
// arbitrate/review:moderate routes already are — no :accountId/
// :propertyId/:projectId param anywhere here for PermissionsGuard's ABAC
// to key on, so every route reaches every row platform-wide, gated
// purely by compliance:read/compliance:write (which only platform_
// reviewer carries — see seed.ts).
@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @RequirePermissions('compliance:read')
  @Get('items')
  findAll() {
    return this.compliance.findAll();
  }

  @RequirePermissions('compliance:write')
  @Post('items')
  create(@Body() dto: CreateComplianceItemDto) {
    return this.compliance.create(dto);
  }

  @RequirePermissions('compliance:write')
  @Patch('items/:id')
  update(@Param('id') id: string, @Body() dto: UpdateComplianceItemDto) {
    return this.compliance.update(id, dto);
  }

  @RequirePermissions('compliance:write')
  @Delete('items/:id')
  remove(@Param('id') id: string) {
    return this.compliance.delete(id);
  }
}
