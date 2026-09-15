import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember, CurrentUser } from '../common/decorators/current-user.decorator';
import { PropertiesService } from './properties.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { CreateValuationDto } from './dto/create-valuation.dto';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { CreateAccessGrantDto } from './dto/create-access-grant.dto';
import { CreateDeviceDto } from './dto/create-device.dto';
import { CreateTourAssetDto } from './dto/create-tour-asset.dto';
import { ScheduleInspectionDto } from './dto/schedule-inspection.dto';
import { UpdateInspectionDto } from './dto/update-inspection.dto';
import { CompleteInspectionDto } from './dto/complete-inspection.dto';
import { CreateLeaseDto } from './dto/create-lease.dto';
import { UpdateLeaseDto } from './dto/update-lease.dto';
import { RecordRentPaymentDto } from './dto/record-rent-payment.dto';
import { AdjustRentScheduleEntryDto } from './dto/adjust-rent-schedule-entry.dto';
import { EndLeaseDto } from './dto/end-lease.dto';
import { ReportMaintenanceRequestDto } from './dto/report-maintenance-request.dto';
import { UpdateMaintenanceRequestDto } from './dto/update-maintenance-request.dto';
import { StartMaintenanceRequestDto } from './dto/start-maintenance-request.dto';
import { ResolveMaintenanceRequestDto } from './dto/resolve-maintenance-request.dto';
import { SetMaintenanceApprovalDto } from './dto/set-maintenance-approval.dto';
import { AddPropertyOwnerDto } from './dto/add-property-owner.dto';
import { UpdatePropertyOwnerDto } from './dto/update-property-owner.dto';

type AccountMemberCtx = { accountId: string };
type UserCtx = { id: string };

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

  // The nav audit's own finding: "Maintenance — missing, lives only
  // inside each property's own detail page, no portfolio-wide view."
  // Must be registered before GET :propertyId below, same reasoning
  // 'search' above already documents, so "maintenance-requests" doesn't
  // get swallowed as a property id.
  @RequirePermissions('maintenance:read')
  @Get('maintenance-requests')
  findAllMaintenanceRequests(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.properties.findAllMaintenanceRequestsForAccount(member.accountId);
  }

  // The nav audit's own finding: "Tenants & Leases — missing, only
  // inside each property's own page." Same "must be registered before
  // GET :propertyId" reasoning as 'search'/'maintenance-requests' above.
  @RequirePermissions('lease:read')
  @Get('leases')
  findAllLeases(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.properties.findAllLeasesForAccount(member.accountId);
  }

  // The nav audit's own finding: "Inspections — missing, only inside
  // each property's own page." Same "must be registered before GET
  // :propertyId" reasoning as the other flat routes above.
  @RequirePermissions('inspection:read')
  @Get('inspections')
  findAllInspections(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.properties.findAllInspectionsForAccount(member.accountId);
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

  // Manual backfill for the Live View feature's own enrichment step —
  // see PropertiesService.regeocodeProperties's own comment.
  @RequirePermissions('property:write')
  @Post('regeocode')
  regeocodeProperties(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.properties.regeocodeProperties(member.accountId);
  }

  // Module 3: Property Details — the first update endpoint the base
  // property record has ever had (see UpdatePropertyDto's own comment).
  // Same property:write gate as create; PermissionsGuard's own
  // :propertyId ABAC (not this controller) is what stops one account
  // from editing another's property here.
  @RequirePermissions('property:write')
  @Patch(':propertyId')
  update(@Param('propertyId') propertyId: string, @Body() dto: UpdatePropertyDto) {
    return this.properties.updateProperty(propertyId, dto);
  }

  // Module 21 Phase 1 — "Family representative access." property:write,
  // same tier account:manage_members already sits at: this is standing
  // access-control configuration, not everyday property data.
  @RequirePermissions('property:write')
  @Post(':propertyId/access-grants')
  createAccessGrant(
    @Param('propertyId') propertyId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: CreateAccessGrantDto,
  ) {
    return this.properties.createOrUpdateAccessGrant(propertyId, member.accountId, dto);
  }

  @RequirePermissions('property:write')
  @Get(':propertyId/access-grants')
  findAccessGrants(@Param('propertyId') propertyId: string) {
    return this.properties.findAccessGrants(propertyId);
  }

  // Deliberately property:read, not property:write like the admin-facing
  // route above — this is "tell me about my own access," which every
  // realistic grant holder already has property:read to ask (see
  // PropertiesService.getMyAccessGrant's own comment). Registered after
  // :grantId's own DELETE route above only for readability; Nest doesn't
  // care about declaration order here since "me" isn't a valid :grantId
  // shape either way.
  @RequirePermissions('property:read')
  @Get(':propertyId/access-grants/me')
  getMyAccessGrant(@Param('propertyId') propertyId: string, @CurrentAccountMember() member: { id: string }) {
    return this.properties.getMyAccessGrant(propertyId, member.id);
  }

  @RequirePermissions('property:write')
  @Delete(':propertyId/access-grants/:grantId')
  revokeAccessGrant(@Param('propertyId') propertyId: string, @Param('grantId') grantId: string) {
    return this.properties.revokeAccessGrant(propertyId, grantId);
  }

  // Module 3 (Ownership and Governance) — the audit's own finding:
  // PropertyOwner has existed since Module 1 with no create/edit route
  // anywhere. property:write, same as the property record itself and
  // access-grant config above — recording who else owns a share is
  // standing property configuration, not everyday data.
  @RequirePermissions('property:write')
  @Post(':propertyId/owners')
  addPropertyOwner(@Param('propertyId') propertyId: string, @Body() dto: AddPropertyOwnerDto) {
    return this.properties.addPropertyOwner(propertyId, dto);
  }

  @RequirePermissions('property:write')
  @Patch(':propertyId/owners/:ownerId')
  updatePropertyOwner(
    @Param('propertyId') propertyId: string,
    @Param('ownerId') ownerId: string,
    @Body() dto: UpdatePropertyOwnerDto,
  ) {
    return this.properties.updatePropertyOwner(propertyId, ownerId, dto);
  }

  @RequirePermissions('property:write')
  @Delete(':propertyId/owners/:ownerId')
  removePropertyOwner(@Param('propertyId') propertyId: string, @Param('ownerId') ownerId: string) {
    return this.properties.removePropertyOwner(propertyId, ownerId);
  }

  // Module 22 Phase 1 — the device registry ("architecture that allows
  // device integrations later through API connectors"). property:write
  // to register/remove, property:read to list, same tier as everything
  // else nested under a single property.
  @RequirePermissions('property:write')
  @Post(':propertyId/devices')
  createDevice(@Param('propertyId') propertyId: string, @Body() dto: CreateDeviceDto) {
    return this.properties.createDevice(propertyId, dto);
  }

  @RequirePermissions('property:read')
  @Get(':propertyId/devices')
  findDevices(@Param('propertyId') propertyId: string) {
    return this.properties.findDevices(propertyId);
  }

  @RequirePermissions('property:write')
  @Delete(':propertyId/devices/:deviceId')
  removeDevice(@Param('propertyId') propertyId: string, @Param('deviceId') deviceId: string) {
    return this.properties.removeDevice(propertyId, deviceId);
  }

  // Module 23 Phase 1 — 360°/tour media metadata.
  @RequirePermissions('property:read')
  @Get(':propertyId/tour-assets')
  findTourAssets(@Param('propertyId') propertyId: string) {
    return this.properties.findTourAssets(propertyId);
  }

  @RequirePermissions('property:write')
  @Post(':propertyId/tour-assets')
  createTourAsset(@Param('propertyId') propertyId: string, @Body() dto: CreateTourAssetDto) {
    return this.properties.createTourAsset(propertyId, dto);
  }

  @RequirePermissions('property:write')
  @Delete(':propertyId/tour-assets/:assetId')
  removeTourAsset(@Param('propertyId') propertyId: string, @Param('assetId') assetId: string) {
    return this.properties.removeTourAsset(propertyId, assetId);
  }

  // "Community management" — account-wide, like search/reindex-embeddings
  // above, not nested under :propertyId (an announcement can reach the
  // whole portfolio — see PropertyAnnouncement's own schema comment).
  // Must be registered before GET :propertyId below, same reasoning
  // semanticSearch's own comment gives for "search".
  @RequirePermissions('property:write')
  @Post('announcements')
  createAnnouncement(
    @CurrentAccountMember() member: AccountMemberCtx,
    @CurrentUser() user: UserCtx,
    @Body() dto: CreateAnnouncementDto,
  ) {
    return this.properties.createAnnouncement(member.accountId, user.id, dto);
  }

  @RequirePermissions('property:read')
  @Get('announcements')
  findAnnouncements(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.properties.findAnnouncements(member.accountId);
  }

  @RequirePermissions('property:write')
  @Delete('announcements/:announcementId')
  deleteAnnouncement(@CurrentAccountMember() member: AccountMemberCtx, @Param('announcementId') announcementId: string) {
    return this.properties.deleteAnnouncement(member.accountId, announcementId);
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

  // The rest of Module 15's valuation gap — see
  // PropertiesService.getComparableValuation's own comment. Same
  // property:read gate as everything else that just reads this property.
  @RequirePermissions('property:read')
  @Get(':propertyId/comparable-valuation')
  getComparableValuation(@Param('propertyId') propertyId: string) {
    return this.properties.getComparableValuation(propertyId);
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
  @Post(':propertyId/inspections/:inspectionId/confirm')
  confirmInspection(@Param('propertyId') propertyId: string, @Param('inspectionId') inspectionId: string) {
    return this.properties.confirmInspection(propertyId, inspectionId);
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

  @RequirePermissions('lease:read')
  @Get(':propertyId/leases/:leaseId/rent-schedule')
  listRentSchedule(@Param('propertyId') propertyId: string, @Param('leaseId') leaseId: string) {
    return this.properties.listRentSchedule(propertyId, leaseId);
  }

  @RequirePermissions('lease:write')
  @Post(':propertyId/leases/:leaseId/rent-schedule/generate-more')
  generateMoreRentSchedule(@Param('propertyId') propertyId: string, @Param('leaseId') leaseId: string) {
    return this.properties.generateMoreRentSchedule(propertyId, leaseId);
  }

  @RequirePermissions('lease:write')
  @Patch(':propertyId/leases/:leaseId/rent-schedule/:entryId')
  adjustRentScheduleEntry(
    @Param('propertyId') propertyId: string,
    @Param('leaseId') leaseId: string,
    @Param('entryId') entryId: string,
    @Body() dto: AdjustRentScheduleEntryDto,
  ) {
    return this.properties.adjustRentScheduleEntry(propertyId, leaseId, entryId, dto);
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

  // Own permission, not maintenance:write — tenant holds maintenance:write
  // (it reports its own requests) but must never approve its own request.
  @RequirePermissions('maintenance:approve')
  @Patch(':propertyId/maintenance-requests/:requestId/approval')
  setMaintenanceApproval(
    @Param('propertyId') propertyId: string,
    @Param('requestId') requestId: string,
    @Body() dto: SetMaintenanceApprovalDto,
  ) {
    return this.properties.setMaintenanceApproval(propertyId, requestId, dto);
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
