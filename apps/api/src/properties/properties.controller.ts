import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember } from '../common/decorators/current-user.decorator';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { CreateValuationDto } from './dto/create-valuation.dto';
import { ScheduleInspectionDto } from './dto/schedule-inspection.dto';
import { UpdateInspectionDto } from './dto/update-inspection.dto';
import { CompleteInspectionDto } from './dto/complete-inspection.dto';
import { CreateLeaseDto } from './dto/create-lease.dto';
import { UpdateLeaseDto } from './dto/update-lease.dto';
import { RecordRentPaymentDto } from './dto/record-rent-payment.dto';
import { EndLeaseDto } from './dto/end-lease.dto';
import { ReportMaintenanceRequestDto } from './dto/report-maintenance-request.dto';
import { UpdateMaintenanceRequestDto } from './dto/update-maintenance-request.dto';
import { StartMaintenanceRequestDto } from './dto/start-maintenance-request.dto';
import { ResolveMaintenanceRequestDto } from './dto/resolve-maintenance-request.dto';

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

  // Semantic search over this account's portfolio — the "vector DB for AI
  // context retrieval" gap the Technical Architecture section calls out.
  // Must be registered before GET :propertyId below so "search" doesn't
  // get swallowed as a property id.
  @RequirePermissions('property:read')
  @Get('search')
  semanticSearch(@CurrentAccountMember() member: AccountMemberCtx, @Query('q') q: string) {
    return this.properties.semanticSearch(member.accountId, q);
  }

  // Manual backfill/reindex — see PropertiesService.reindexEmbeddings's
  // own comment on why this exists alongside the automatic on-create
  // indexing. property:write since it's a write to this account's own
  // derived search data, not a new permission tier.
  @RequirePermissions('property:write')
  @Post('reindex-embeddings')
  reindexEmbeddings(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.properties.reindexEmbeddings(member.accountId);
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

  // Same gate as the valuations it's built from — a real numbers-and-chart
  // dashboard on top of model_roi_scenario's "current" scenario, not a new
  // permission area.
  @RequirePermissions('property:read')
  @Get(':propertyId/roi-summary')
  getRoiSummary(@Param('propertyId') propertyId: string) {
    return this.properties.getRoiSummary(propertyId);
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

  @RequirePermissions('inspection:write')
  @Patch(':propertyId/inspections/:inspectionId')
  updateInspection(
    @Param('propertyId') propertyId: string,
    @Param('inspectionId') inspectionId: string,
    @Body() dto: UpdateInspectionDto,
  ) {
    return this.properties.updateInspection(propertyId, inspectionId, dto);
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

  @RequirePermissions('lease:write')
  @Patch(':propertyId/leases/:leaseId')
  updateLease(@Param('propertyId') propertyId: string, @Param('leaseId') leaseId: string, @Body() dto: UpdateLeaseDto) {
    return this.properties.updateLease(propertyId, leaseId, dto);
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

  // Module 13's "no separate Tenant identity" gap — see
  // PropertiesService.linkTenantAccount's own comment. Same lease:write
  // gate as the rest of this lease's mutations.
  @RequirePermissions('lease:write')
  @Post(':propertyId/leases/:leaseId/link-tenant')
  linkTenantAccount(@Param('propertyId') propertyId: string, @Param('leaseId') leaseId: string) {
    return this.properties.linkTenantAccount(propertyId, leaseId);
  }

  // Module 12 — own permission pair, same reasoning as inspection/lease
  // above.
  @RequirePermissions('maintenance:write')
  @Post(':propertyId/maintenance-requests')
  reportMaintenanceRequest(@Param('propertyId') propertyId: string, @Body() dto: ReportMaintenanceRequestDto) {
    return this.properties.reportMaintenanceRequest(propertyId, dto);
  }

  @RequirePermissions('maintenance:write')
  @Patch(':propertyId/maintenance-requests/:requestId')
  updateMaintenanceRequest(
    @Param('propertyId') propertyId: string,
    @Param('requestId') requestId: string,
    @Body() dto: UpdateMaintenanceRequestDto,
  ) {
    return this.properties.updateMaintenanceRequest(propertyId, requestId, dto);
  }

  @RequirePermissions('maintenance:read')
  @Get(':propertyId/maintenance-requests')
  findMaintenanceRequests(@Param('propertyId') propertyId: string) {
    return this.properties.findMaintenanceRequests(propertyId);
  }

  @RequirePermissions('maintenance:read')
  @Get(':propertyId/maintenance-requests/:requestId')
  findMaintenanceRequest(@Param('propertyId') propertyId: string, @Param('requestId') requestId: string) {
    return this.properties.findMaintenanceRequest(propertyId, requestId);
  }

  @RequirePermissions('maintenance:write')
  @Post(':propertyId/maintenance-requests/:requestId/start')
  startMaintenanceRequest(
    @Param('propertyId') propertyId: string,
    @Param('requestId') requestId: string,
    @Body() dto: StartMaintenanceRequestDto,
  ) {
    return this.properties.startMaintenanceRequest(propertyId, requestId, dto);
  }

  @RequirePermissions('maintenance:write')
  @Post(':propertyId/maintenance-requests/:requestId/resolve')
  resolveMaintenanceRequest(
    @Param('propertyId') propertyId: string,
    @Param('requestId') requestId: string,
    @Body() dto: ResolveMaintenanceRequestDto,
  ) {
    return this.properties.resolveMaintenanceRequest(propertyId, requestId, dto);
  }

  @RequirePermissions('maintenance:write')
  @Post(':propertyId/maintenance-requests/:requestId/cancel')
  cancelMaintenanceRequest(@Param('propertyId') propertyId: string, @Param('requestId') requestId: string) {
    return this.properties.cancelMaintenanceRequest(propertyId, requestId);
  }
}
