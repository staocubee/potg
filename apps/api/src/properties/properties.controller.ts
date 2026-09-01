import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember } from '../common/decorators/current-user.decorator';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { CreateValuationDto } from './dto/create-valuation.dto';
import { ScheduleInspectionDto } from './dto/schedule-inspection.dto';
import { CompleteInspectionDto } from './dto/complete-inspection.dto';
import { CreateLeaseDto } from './dto/create-lease.dto';
import { RecordRentPaymentDto } from './dto/record-rent-payment.dto';
import { EndLeaseDto } from './dto/end-lease.dto';

type AccountMemberCtx = { accountId: string };

@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller('properties')
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @RequirePermissions('property:write')
  @Post()
  create(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: CreatePropertyDto) {
    return this.properties.create(member.accountId, dto);
  }

  @RequirePermissions('property:read')
  @Get()
  findAll(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.properties.findAllForAccount(member.accountId);
  }

  // :propertyId (not :id) is deliberate — PermissionsGuard's ABAC check
  // looks for that exact param name to enforce tenant isolation.
  @RequirePermissions('property:read')
  @Get(':propertyId')
  findOne(@Param('propertyId') propertyId: string) {
    return this.properties.findOne(propertyId);
  }

  // Module 15 — no new permission keys needed, valuations are gated by the
  // same property:read/write pair as the property record they belong to.
  @RequirePermissions('property:write')
  @Post(':propertyId/valuations')
  addValuation(@Param('propertyId') propertyId: string, @Body() dto: CreateValuationDto) {
    return this.properties.addValuation(propertyId, dto);
  }

  @RequirePermissions('property:read')
  @Get(':propertyId/valuations')
  findValuations(@Param('propertyId') propertyId: string) {
    return this.properties.findValuations(propertyId);
  }

  // Module 8 — its own permission pair (not property:read/write) since
  // "who can see a property" and "who can schedule/complete an inspection
  // on it" are reasonable to grant separately, unlike valuations above
  // which really are just more property data.
  @RequirePermissions('inspection:write')
  @Post(':propertyId/inspections')
  scheduleInspection(@Param('propertyId') propertyId: string, @Body() dto: ScheduleInspectionDto) {
    return this.properties.scheduleInspection(propertyId, dto);
  }

  @RequirePermissions('inspection:read')
  @Get(':propertyId/inspections')
  findInspections(@Param('propertyId') propertyId: string) {
    return this.properties.findInspections(propertyId);
  }

  @RequirePermissions('inspection:read')
  @Get(':propertyId/inspections/:inspectionId')
  findInspection(@Param('propertyId') propertyId: string, @Param('inspectionId') inspectionId: string) {
    return this.properties.findInspection(propertyId, inspectionId);
  }

  @RequirePermissions('inspection:write')
  @Post(':propertyId/inspections/:inspectionId/complete')
  completeInspection(
    @Param('propertyId') propertyId: string,
    @Param('inspectionId') inspectionId: string,
    @Body() dto: CompleteInspectionDto,
  ) {
    return this.properties.completeInspection(propertyId, inspectionId, dto);
  }

  @RequirePermissions('inspection:write')
  @Post(':propertyId/inspections/:inspectionId/cancel')
  cancelInspection(@Param('propertyId') propertyId: string, @Param('inspectionId') inspectionId: string) {
    return this.properties.cancelInspection(propertyId, inspectionId);
  }

  // Module 13 — own permission pair, same reasoning as inspection:read/
  // write above.
  @RequirePermissions('lease:write')
  @Post(':propertyId/leases')
  createLease(@Param('propertyId') propertyId: string, @Body() dto: CreateLeaseDto) {
    return this.properties.createLease(propertyId, dto);
  }

  @RequirePermissions('lease:read')
  @Get(':propertyId/leases')
  findLeases(@Param('propertyId') propertyId: string) {
    return this.properties.findLeases(propertyId);
  }

  @RequirePermissions('lease:read')
  @Get(':propertyId/leases/:leaseId')
  findLease(@Param('propertyId') propertyId: string, @Param('leaseId') leaseId: string) {
    return this.properties.findLease(propertyId, leaseId);
  }

  @RequirePermissions('lease:write')
  @Post(':propertyId/leases/:leaseId/rent-payments')
  recordRentPayment(
    @Param('propertyId') propertyId: string,
    @Param('leaseId') leaseId: string,
    @Body() dto: RecordRentPaymentDto,
  ) {
    return this.properties.recordRentPayment(propertyId, leaseId, dto);
  }

  @RequirePermissions('lease:write')
  @Post(':propertyId/leases/:leaseId/end')
  endLease(@Param('propertyId') propertyId: string, @Param('leaseId') leaseId: string, @Body() dto: EndLeaseDto) {
    return this.properties.endLease(propertyId, leaseId, dto);
  }
}
