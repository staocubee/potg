import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OpenAiEmbeddingService } from './openai-embedding.service';
import { GoogleGeocodingService } from './google-geocoding.service';
import { Property } from '@prisma/client';
import { CreatePropertyDto } from './dto/create-property.dto';
import { CreateValuationDto } from './dto/create-valuation.dto';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { CreateAccessGrantDto } from './dto/create-access-grant.dto';
import { CreateDeviceDto } from './dto/create-device.dto';
import { CreateTourAssetDto } from './dto/create-tour-asset.dto';
import { InAppNotificationsService } from '../notifications/in-app-notifications.service';
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
import { SetMaintenanceApprovalDto } from './dto/set-maintenance-approval.dto';
import { AddPropertyOwnerDto } from './dto/add-property-owner.dto';
import { UpdatePropertyOwnerDto } from './dto/update-property-owner.dto';
import { computeUpcomingRentDueDates } from '../common/rent-schedule.util';

// Service categories where a real license is what "licensed" means in
// this scaffold's own terms — see the schema comment on
// Vendor.licenseNumber, which names this same trio as the ones a real
// license actually applies to. Deliberately not the rest of
// CreateVendorDto's own category list (renovation, plumbing,
// landscaping, painting, roofing, interior_design, cleaning) — nothing
// here decides which of those are genuinely regulated trades in a given
// jurisdiction, so only the three already named elsewhere are gated.
const LICENSE_REQUIRED_CATEGORIES = ['electrical', 'security_installation', 'general_contracting'];

@Injectable()
export class PropertiesService {
  private readonly logger = new Logger(PropertiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: OpenAiEmbeddingService,
    private readonly notifications: InAppNotificationsService,
    private readonly geocoding: GoogleGeocodingService,
  ) {}

  // Shared by every inspectorVendor/assignedVendor include below, so a
  // just-created row and a re-fetched one carry the same shape.
  private readonly vendorSummarySelect = { id: true, businessName: true, serviceCategory: true, verificationStatus: true } as const;

  async create(accountId: string, dto: CreatePropertyDto) {
    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({ where: { id: dto.branchId, accountId } });
      if (!branch) throw new BadRequestException('That branch does not belong to this account');
    }
    const property = await this.prisma.property.create({
      data: { accountId, ...dto },
    });
    // Module 2: "View property timeline" — seed it the moment the property
    // exists so the timeline is never empty for a property that's in the
    // system at all.
    await this.prisma.propertyTimelineEvent.create({
      data: {
        propertyId: property.id,
        eventType: 'created',
        label: 'Property added to portfolio',
      },
    });
    // Fire-and-forget: semantic search is an enrichment, not something the
    // caller is waiting on, and OpenAI being unconfigured/rate-limited/
    // out of credit shouldn't fail property creation itself. Swallowed and
    // logged, not the "record-then-rethrow" pattern the visualizer/
    // identity services use for their own primary action.
    this.indexEmbedding(property).catch((err) => {
      this.logger.warn(`Skipping embedding for property ${property.id}: ${err instanceof Error ? err.message : err}`);
    });
    // Same fire-and-forget reasoning as indexEmbedding just above — the
    // "live view" map/Street View on the property page is an enrichment
    // once geocoding lands, not something property creation should ever
    // wait on or fail over. Only runs when the caller didn't already
    // supply coordinates of their own (CreatePropertyDto still accepts
    // manual latitude/longitude — this never overwrites a value someone
    // deliberately provided).
    if (dto.latitude == null || dto.longitude == null) {
      this.geocodeProperty(property).catch((err) => {
        this.logger.warn(`Skipping geocoding for property ${property.id}: ${err instanceof Error ? err.message : err}`);
      });
    }
    return property;
  }

  private async geocodeProperty(property: Property) {
    const address = [property.addressLine, property.city, property.state, property.country].filter(Boolean).join(', ');
    const coords = await this.geocoding.geocode(address);
    if (!coords) return;
    await this.prisma.property.update({ where: { id: property.id }, data: coords });
  }

  // The text representation embedded for semantic search — every field a
  // free-text query like "3 bedroom flat in Lekki under renovation" could
  // plausibly be asking about. Deliberately excludes ids/dates/computed
  // fields that add noise, not signal, to a semantic match. Module 3's
  // own fields close the gap this comment's own example query used to
  // point at with nothing behind it — there was no `bedrooms` field
  // anywhere in this schema until now.
  private embeddingText(property: Property): string {
    return [
      property.name,
      property.propertyType,
      property.addressLine,
      property.city,
      property.state,
      property.country,
      property.currentUse ? `currently used as ${property.currentUse}` : null,
      property.estimatedValue ? `estimated value ${property.estimatedValue.toString()}` : null,
      property.bedrooms != null ? `${property.bedrooms} bedroom(s)` : null,
      property.bathrooms != null ? `${property.bathrooms} bathroom(s)` : null,
      property.squareFootage != null ? `${property.squareFootage} sq ft` : null,
      property.yearBuilt != null ? `built in ${property.yearBuilt}` : null,
      property.amenities.length > 0 ? `amenities: ${property.amenities.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('. ');
  }

  // Raw SQL for the vector column — Prisma's query builder can't read or
  // write an Unsupported("vector(1536)") field, same "$queryRaw/
  // $executeRaw for the part Prisma can't express" split the marketplace
  // fuzzy-search pass used for pg_trgm. The embedding array is passed as
  // a normal string parameter (pgvector accepts '[0.1,0.2,...]' text
  // input) and cast with `::vector` — never string-concatenated into the
  // query itself.
  private async indexEmbedding(property: Property) {
    const embedding = await this.embeddings.embed(this.embeddingText(property));
    const vectorLiteral = `[${embedding.join(',')}]`;
    await this.prisma.$executeRaw`
      INSERT INTO property_embeddings ("propertyId", "accountId", embedding, "updatedAt")
      VALUES (${property.id}, ${property.accountId}, ${vectorLiteral}::vector, now())
      ON CONFLICT ("propertyId") DO UPDATE SET embedding = EXCLUDED.embedding, "updatedAt" = now()
    `;
  }

  // Manual backfill/reindex for properties created before this pass (or
  // after OpenAI credit is restored) — see the README's own note on why
  // this can't be verified end-to-end yet. Sequential, not Promise.all,
  // to stay gentle on OpenAI's own per-account rate limit; per-property
  // errors are collected rather than aborting the whole batch on the
  // first failure, since "OpenAI has no credit" fails every one of them
  // identically and the caller should still see that clearly.
  async reindexEmbeddings(accountId: string) {
    const properties = await this.prisma.property.findMany({ where: { accountId } });
    let indexed = 0;
    const failures: { propertyId: string; error: string }[] = [];
    for (const property of properties) {
      try {
        await this.indexEmbedding(property);
        indexed += 1;
      } catch (err) {
        failures.push({ propertyId: property.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { total: properties.length, indexed, failed: failures.length, failures };
  }

  // Same manual-backfill reasoning as reindexEmbeddings just above, for
  // the other enrichment this account's properties might be missing:
  // every property created (or address-edited) before GOOGLE_MAPS_API_KEY
  // was configured on this deployment never got geocoded, since that's a
  // fire-and-forget step at write time, not something re-run on its own.
  // Only ever geocodes properties still missing coordinates — never
  // overwrites one a manual latitude/longitude (or an earlier successful
  // geocode) already set.
  async regeocodeProperties(accountId: string) {
    const properties = await this.prisma.property.findMany({
      where: { accountId, OR: [{ latitude: null }, { longitude: null }] },
    });
    let located = 0;
    const failures: { propertyId: string; error: string }[] = [];
    for (const property of properties) {
      try {
        const address = [property.addressLine, property.city, property.state, property.country].filter(Boolean).join(', ');
        const coords = await this.geocoding.geocode(address);
        if (coords) {
          await this.prisma.property.update({ where: { id: property.id }, data: coords });
          located += 1;
        }
      } catch (err) {
        failures.push({ propertyId: property.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { total: properties.length, located, failed: failures.length, failures };
  }

  // Semantic search (Module — "vector DB for AI context retrieval"): embed
  // the query, rank property ids by cosine distance in raw SQL, then
  // hydrate+re-sort with Prisma — the exact same "raw SQL for ranking,
  // Prisma for hydration, JS sort for order" split ListingsService.findAll
  // uses for pg_trgm. accountId is filtered directly on
  // property_embeddings (denormalized there for this reason) so this
  // never returns another account's properties.
  async semanticSearch(accountId: string, q: string) {
    const embedding = await this.embeddings.embed(q);
    const vectorLiteral = `[${embedding.join(',')}]`;
    const matches = await this.prisma.$queryRaw<{ propertyId: string }[]>`
      SELECT "propertyId" FROM property_embeddings
      WHERE "accountId" = ${accountId}
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT 20
    `;
    const order = matches.map((m) => m.propertyId);
    if (order.length === 0) return [];
    const properties = await this.prisma.property.findMany({ where: { id: { in: order } } });
    const rank = new Map(order.map((id, i) => [id, i]));
    return properties.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  }

  findAllForAccount(accountId: string) {
    return this.prisma.property.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const property = await this.prisma.property.findUnique({
      where: { id },
      include: {
        owners: true,
        documents: true,
        timelineEvents: { orderBy: { occurredAt: 'asc' } },
      },
    });
    if (!property) return property;
    return { ...property, owners: await this.withOwnerNames(property.owners) };
  }

  // ownerAccountId/ownerUserId are soft references (no Prisma relation —
  // same reasoning ListingOffer.accountId's own schema comment gives),
  // so a plain `include` can't join them. Resolved here instead of left
  // as bare ids the UI would otherwise have nothing to display.
  private async withOwnerNames(owners: { ownerType: string; ownerAccountId: string | null; ownerUserId: string | null }[]) {
    const accountIds = owners.filter((o) => o.ownerType === 'account' && o.ownerAccountId).map((o) => o.ownerAccountId!);
    const userIds = owners.filter((o) => o.ownerType === 'user' && o.ownerUserId).map((o) => o.ownerUserId!);
    const [accounts, users] = await Promise.all([
      accountIds.length ? this.prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } }) : [],
      userIds.length ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    ]);
    const accountNames = new Map(accounts.map((a) => [a.id, a.name]));
    const userNames = new Map(users.map((u) => [u.id, u.name]));
    return owners.map((o) => ({
      ...o,
      ownerName:
        o.ownerType === 'account'
          ? (o.ownerAccountId && accountNames.get(o.ownerAccountId)) ?? 'Unknown account'
          : (o.ownerUserId && userNames.get(o.ownerUserId)) ?? 'Unknown user',
    }));
  }

  // Module 21 Phase 1 — "Family representative access." Upsert on the
  // schema's own [propertyId, accountMemberId] unique constraint: granting
  // twice just updates the existing grant rather than erroring or
  // duplicating. accountMemberId is validated against this same account —
  // granting access to a member of a *different* account would defeat the
  // entire point of a tenant-isolated access-control feature.
  async createOrUpdateAccessGrant(propertyId: string, accountId: string, dto: CreateAccessGrantDto) {
    const member = await this.prisma.accountMember.findUnique({ where: { id: dto.accountMemberId } });
    if (!member || member.accountId !== accountId) {
      throw new NotFoundException('Account member not found');
    }
    return this.prisma.propertyAccessGrant.upsert({
      where: { propertyId_accountMemberId: { propertyId, accountMemberId: dto.accountMemberId } },
      update: { canView: dto.canView, canEdit: dto.canEdit, canApprovePayments: dto.canApprovePayments },
      create: {
        propertyId,
        accountMemberId: dto.accountMemberId,
        canView: dto.canView ?? true,
        canEdit: dto.canEdit ?? false,
        canApprovePayments: dto.canApprovePayments ?? false,
      },
    });
  }

  findAccessGrants(propertyId: string) {
    return this.prisma.propertyAccessGrant.findMany({
      where: { propertyId },
      include: { accountMember: { include: { user: { select: { name: true, email: true } }, role: { select: { key: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeAccessGrant(propertyId: string, grantId: string) {
    const grant = await this.prisma.propertyAccessGrant.findUnique({ where: { id: grantId } });
    if (!grant || grant.propertyId !== propertyId) {
      throw new NotFoundException('Access grant not found');
    }
    await this.prisma.propertyAccessGrant.delete({ where: { id: grantId } });
    return { deleted: true };
  }

  // The gap the "Release funds" UI-gating pass left open: findAccessGrants
  // above lists every grant on a property, but is itself gated on
  // property:write — exactly the permission a grant exists to substitute
  // for, so its own holder could never call it to find out about their
  // own access. This is the same data, narrowed to "just tell me about
  // me," gated at the much lower property:read bar every realistic
  // grant-holder already has (see this method's own frontend caller for
  // why). Returns null, not a 404, when there's no grant — "no grant" is
  // a perfectly normal answer here, not a missing resource.
  getMyAccessGrant(propertyId: string, accountMemberId: string) {
    return this.prisma.propertyAccessGrant.findUnique({
      where: { propertyId_accountMemberId: { propertyId, accountMemberId } },
    });
  }

  // Module 22's device registry — see PropertyDevice's own schema
  // comment: a real record of intent to connect a device, always created
  // at "not_connected" since no adapter exists yet to ever report
  // otherwise.
  createDevice(propertyId: string, dto: CreateDeviceDto) {
    return this.prisma.propertyDevice.create({
      data: { propertyId, deviceType: dto.deviceType, name: dto.name, provider: dto.provider },
    });
  }

  findDevices(propertyId: string) {
    return this.prisma.propertyDevice.findMany({ where: { propertyId }, orderBy: { createdAt: 'desc' } });
  }

  async removeDevice(propertyId: string, deviceId: string) {
    const device = await this.prisma.propertyDevice.findUnique({ where: { id: deviceId } });
    if (!device || device.propertyId !== propertyId) {
      throw new NotFoundException('Device not found');
    }
    await this.prisma.propertyDevice.delete({ where: { id: deviceId } });
    return { deleted: true };
  }

  // Module 23's "store media metadata in a way that supports 360 content
  // and virtual tour assets."
  findTourAssets(propertyId: string) {
    return this.prisma.propertyTourAsset.findMany({
      where: { propertyId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  createTourAsset(propertyId: string, dto: CreateTourAssetDto) {
    return this.prisma.propertyTourAsset.create({
      data: {
        propertyId,
        mediaUrl: dto.mediaUrl,
        mediaType: dto.mediaType,
        label: dto.label,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async removeTourAsset(propertyId: string, assetId: string) {
    const asset = await this.prisma.propertyTourAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.propertyId !== propertyId) {
      throw new NotFoundException('Tour asset not found');
    }
    await this.prisma.propertyTourAsset.delete({ where: { id: assetId } });
    return { deleted: true };
  }

  // Module 3: Property Details — the base Property record had no update
  // endpoint at all before this: only nested resources (valuations,
  // inspections, leases, maintenance) could be edited after creation.
  // Re-indexes the embedding fire-and-forget on any change, same
  // swallow-and-log reasoning `create` already uses — a stale embedding
  // is a search-quality issue, not something that should fail an edit.
  async updateProperty(propertyId: string, dto: UpdatePropertyDto) {
    // Module 24's Branch feature — the account a branchId belongs to
    // isn't otherwise checked anywhere on this route (:branchId isn't a
    // URL param here for PermissionsGuard's own ABAC check to key on,
    // since this arrives in the body), so this is the one place that
    // actually has to confirm it before letting the assignment through.
    if (dto.branchId) {
      const owner = await this.prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { accountId: true } });
      const branch = await this.prisma.branch.findFirst({ where: { id: dto.branchId, accountId: owner.accountId } });
      if (!branch) throw new BadRequestException('That branch does not belong to this account');
    }
    const property = await this.prisma.property.update({
      where: { id: propertyId },
      // Empty string means "unassign" — same convention
      // UpdateInspectionDto.projectId's own handling already uses.
      data: { ...dto, branchId: dto.branchId !== undefined ? dto.branchId || null : undefined },
    });
    this.indexEmbedding(property).catch((err) => {
      this.logger.warn(`Skipping re-index for property ${property.id}: ${err instanceof Error ? err.message : err}`);
    });
    // Re-geocode whenever the address itself changed and the caller
    // didn't hand-supply new coordinates in the same edit — same
    // "enrichment, not a blocking step" reasoning `create` uses above.
    const addressChanged = dto.addressLine !== undefined || dto.city !== undefined || dto.state !== undefined || dto.country !== undefined;
    if (addressChanged && dto.latitude == null && dto.longitude == null) {
      this.geocodeProperty(property).catch((err) => {
        this.logger.warn(`Skipping re-geocoding for property ${property.id}: ${err instanceof Error ? err.message : err}`);
      });
    }
    return property;
  }

  // "Community management" — see PropertyAnnouncement's own schema
  // comment for the full scoping reasoning. Account-scoped like
  // findAllForAccount above, not nested under :propertyId — an
  // announcement can reach the whole portfolio, not just one property —
  // so propertyId (when given) is validated by hand here rather than by
  // PermissionsGuard's own :propertyId ABAC, which only ever fires for a
  // route *param* literally named :propertyId, never a body field.
  async createAnnouncement(accountId: string, createdByUserId: string, dto: CreateAnnouncementDto) {
    if (dto.propertyId) {
      const property = await this.prisma.property.findUnique({ where: { id: dto.propertyId } });
      if (!property || property.accountId !== accountId) {
        throw new NotFoundException('Property not found');
      }
    }
    return this.prisma.propertyAnnouncement.create({
      data: { accountId, createdByUserId, title: dto.title, body: dto.body, propertyId: dto.propertyId },
    });
  }

  findAnnouncements(accountId: string) {
    return this.prisma.propertyAnnouncement.findMany({
      where: { accountId },
      include: { property: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteAnnouncement(accountId: string, announcementId: string) {
    const announcement = await this.prisma.propertyAnnouncement.findUnique({ where: { id: announcementId } });
    if (!announcement || announcement.accountId !== accountId) {
      throw new NotFoundException('Announcement not found');
    }
    await this.prisma.propertyAnnouncement.delete({ where: { id: announcementId } });
    return { deleted: true };
  }

  // Module 15's "manual valuation records... appreciation tracking" — a
  // plain history a human or the ai_estimate source can append to; nothing
  // recomputes Property.estimatedValue automatically from this, that field
  // stays whatever the owner set it to.
  async addValuation(propertyId: string, dto: CreateValuationDto) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      include: { account: { select: { currency: true } } },
    });
    if (!property) throw new NotFoundException('Property not found');
    return this.prisma.propertyValuation.create({
      data: {
        propertyId,
        estimatedValue: dto.estimatedValue,
        currency: dto.currency ?? property.account.currency,
        source: dto.source ?? 'manual',
        notes: dto.notes,
      },
    });
  }

  findValuations(propertyId: string) {
    return this.prisma.propertyValuation.findMany({
      where: { propertyId },
      orderBy: { valuedAt: 'desc' },
    });
  }

  // The rest of Module 15's valuation gap this scaffold left open — a
  // real (if simple) automated estimate, not just a manual/AI-narrated
  // history a human types numbers into. "Comparable" here means the same
  // city and propertyType among other accounts' own active sale listings
  // — a real market signal already sitting in PropertyListing, not a new
  // integration. Deliberately excludes this property's own listing(s):
  // comparing a property to itself isn't a comparable-sales estimate.
  //
  // Grouped by currency, never averaged across them — same caution every
  // other cross-listing money computation in this codebase already
  // applies (PaymentsService.getAccountOverview, ReportsService's own
  // vendor-spend grouping): a market can have listings priced in more
  // than one currency, and blending them would be meaningless, not just
  // imprecise. Nothing here writes back to Property.estimatedValue —
  // same "record what's true, don't auto-recompute" tradeoff addValuation
  // above already established; saving this as a real valuation is a
  // separate, explicit POST /properties/:id/valuations call the caller
  // makes with source: "comparable_sales".
  async getComparableValuation(propertyId: string) {
    const property = await this.prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) throw new NotFoundException('Property not found');

    const comparableListings = await this.prisma.propertyListing.findMany({
      where: {
        status: 'active',
        listingType: 'sale',
        propertyId: { not: propertyId },
        property: { city: property.city, propertyType: property.propertyType },
      },
      select: { id: true, title: true, askingPrice: true, currency: true },
    });

    const MIN_COMPARABLES = 2;
    const byCurrency = new Map<
      string,
      { total: number; min: number; max: number; comparables: { listingId: string; title: string; askingPrice: number }[] }
    >();
    for (const listing of comparableListings) {
      const price = Number(listing.askingPrice);
      const group = byCurrency.get(listing.currency) ?? { total: 0, min: Infinity, max: -Infinity, comparables: [] };
      group.total += price;
      group.min = Math.min(group.min, price);
      group.max = Math.max(group.max, price);
      group.comparables.push({ listingId: listing.id, title: listing.title, askingPrice: price });
      byCurrency.set(listing.currency, group);
    }

    const estimates = Array.from(byCurrency, ([currency, group]) => ({
      currency,
      comparableCount: group.comparables.length,
      // Below MIN_COMPARABLES, still show what was found (so the caller
      // can see there's *something* nearby), just no averaged estimate —
      // one listing isn't a market, it's an anecdote.
      estimatedValue: group.comparables.length >= MIN_COMPARABLES ? Math.round(group.total / group.comparables.length) : null,
      minAskingPrice: group.min,
      maxAskingPrice: group.max,
      comparables: group.comparables,
    })).sort((a, b) => b.comparableCount - a.comparableCount);

    return {
      city: property.city,
      propertyType: property.propertyType,
      minComparablesRequired: MIN_COMPARABLES,
      estimates,
    };
  }

  // Module 15's "do financials" surface as a real dashboard, not just
  // model_roi_scenario's chat-narrated numbers — same current-value/
  // invested computation that AI skill uses, deliberately kept in sync
  // (latest PropertyValuation, or Property.estimatedValue as a fallback;
  // Property.estimatedValue also doubles as an acquisition-cost stand-in
  // — this scaffold has no separate purchase-price field), but returned
  // as real numbers for stat tiles and a chart instead of AI-narrated
  // text, plus the full valuation history and a rental-yield figure the
  // skill doesn't compute at all.
  async getRoiSummary(propertyId: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      include: { account: { select: { currency: true } } },
    });
    if (!property) throw new NotFoundException('Property not found');

    const valuationHistory = await this.prisma.propertyValuation.findMany({
      where: { propertyId },
      orderBy: { valuedAt: 'asc' },
    });
    const latestValuation = valuationHistory[valuationHistory.length - 1];
    const currentValue = latestValuation ? Number(latestValuation.estimatedValue) : Number(property.estimatedValue ?? 0);
    const currency = latestValuation?.currency ?? property.account.currency;

    const projects = await this.prisma.project.findMany({ where: { propertyId }, select: { id: true } });
    const projectIds = projects.map((p) => p.id);
    const payouts = projectIds.length
      ? await this.prisma.payout.findMany({ where: { projectId: { in: projectIds }, status: { not: 'failed' } } })
      : [];
    // grossAmount, not amount — "what has this property actually cost
    // its owner" is unaffected by the platform's own fee cut (see
    // src/payments/platform-fee.ts), which only reduces the vendor's own
    // net take-home, not the milestone value the owner funded.
    const totalProjectSpend = payouts.reduce((sum, p) => sum + Number(p.grossAmount), 0);
    const acquisitionValue = Number(property.estimatedValue ?? currentValue);
    const invested = acquisitionValue + totalProjectSpend;
    const simpleRoiPercent = invested > 0 ? ((currentValue - invested) / invested) * 100 : 0;

    // Gross rental yield across every currently active lease — Lease has
    // no constraint tying a property to at most one active tenancy at a
    // time (same plural "active leases" handling
    // summarize-lease-status.skill.ts already gives), so this sums
    // annualized rent across all of them rather than assuming there's
    // exactly one.
    const activeLeases = await this.prisma.lease.findMany({ where: { propertyId, status: 'active' } });
    const annualMultiplier: Record<string, number> = { weekly: 52, monthly: 12, annually: 1 };
    const totalAnnualRent = activeLeases.reduce(
      (sum, l) => sum + Number(l.rentAmount) * (annualMultiplier[l.rentFrequency] ?? 12),
      0,
    );
    const grossYieldPercent = currentValue > 0 ? (totalAnnualRent / currentValue) * 100 : 0;

    return {
      currency,
      currentValue,
      acquisitionValue,
      totalProjectSpend,
      invested,
      simpleRoiPercent,
      totalAnnualRent,
      grossYieldPercent,
      valuationHistory: valuationHistory.map((v) => ({
        id: v.id,
        estimatedValue: Number(v.estimatedValue),
        currency: v.currency,
        source: v.source,
        valuedAt: v.valuedAt,
      })),
    };
  }

  // Module 8. If dto.projectId is set, it must actually be a project on
  // this same property — same "don't let a caller wire two unrelated
  // records together just because both ids are technically valid" check
  // VendorsService.createReview and PaymentsService.raiseDispute make for
  // their own optional cross-references.
  async scheduleInspection(propertyId: string, dto: ScheduleInspectionDto) {
    if (dto.projectId) {
      const project = await this.prisma.project.findFirst({ where: { id: dto.projectId, propertyId } });
      if (!project) throw new BadRequestException('That project does not belong to this property');
    }
    if (dto.stageId) {
      if (!dto.projectId) throw new BadRequestException('A stage can only be set alongside the project it belongs to');
      const stage = await this.prisma.projectStage.findFirst({ where: { id: dto.stageId, projectId: dto.projectId } });
      if (!stage) throw new BadRequestException('That stage does not belong to this project');
    }
    if (dto.inspectorVendorId) await this.requireVendor(dto.inspectorVendorId);
    return this.prisma.propertyInspection.create({
      data: {
        propertyId,
        projectId: dto.projectId,
        stageId: dto.stageId,
        inspectionType: dto.inspectionType,
        scheduledFor: new Date(dto.scheduledFor),
        inspectorVendorId: dto.inspectorVendorId,
        inspectorName: dto.inspectorVendorId ? undefined : dto.inspectorName,
      },
      include: { inspectorVendor: { select: this.vendorSummarySelect } },
    });
  }

  // Referential-integrity check for an optional Vendor cross-reference —
  // used wherever inspectorVendorId/assignedVendorId is accepted, same
  // spirit as the propertyId-scoped project/lease checks above but a
  // Vendor is a marketplace-wide profile, not scoped to this property.
  //
  // Also the "no way to require a vendor actually have a license before
  // it can be picked" gap the README flagged for both Property
  // inspections and Maintenance requests — closed once, here, since this
  // is the one choke point both inspectorVendorId and assignedVendorId
  // already pass through. Only enforced for the trades
  // LICENSE_REQUIRED_CATEGORIES actually names; every other category
  // (including a vendor picked as a general inspector) is unaffected,
  // same "record what's true, no forced workflow" reasoning the freeform
  // inspectorName/assignedTo path next to this one already follows.
  private async requireVendor(vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new BadRequestException('That vendor does not exist');
    if (LICENSE_REQUIRED_CATEGORIES.includes(vendor.serviceCategory)) {
      const category = vendor.serviceCategory.replace(/_/g, ' ');
      if (!vendor.licenseNumber) {
        throw new BadRequestException(
          `${vendor.businessName} has no professional license on file — required for a ${category} vendor to be assigned here`,
        );
      }
      if (vendor.licenseExpiresAt && vendor.licenseExpiresAt.getTime() < Date.now()) {
        throw new BadRequestException(
          `${vendor.businessName}'s professional license has expired — required for a ${category} vendor to be assigned here`,
        );
      }
    }
    return vendor;
  }

  // Closes the "no way to edit a scheduled inspection" gap the README
  // flagged when this module was first built — only while still
  // "scheduled", same reasoning completeInspection/cancelInspection
  // already gate on. Empty string clears an existing projectId link.
  async updateInspection(propertyId: string, inspectionId: string, dto: UpdateInspectionDto) {
    const inspection = await this.prisma.propertyInspection.findFirst({ where: { id: inspectionId, propertyId } });
    if (!inspection) throw new NotFoundException('Inspection not found on this property');
    if (inspection.status !== 'scheduled') {
      throw new BadRequestException(`This inspection is already "${inspection.status}" — only a scheduled inspection can be edited`);
    }
    if (dto.projectId) {
      const project = await this.prisma.project.findFirst({ where: { id: dto.projectId, propertyId } });
      if (!project) throw new BadRequestException('That project does not belong to this property');
    }
    if (dto.stageId) {
      const effectiveProjectId = dto.projectId !== undefined ? dto.projectId : inspection.projectId;
      if (!effectiveProjectId) throw new BadRequestException('A stage can only be set alongside the project it belongs to');
      const stage = await this.prisma.projectStage.findFirst({ where: { id: dto.stageId, projectId: effectiveProjectId } });
      if (!stage) throw new BadRequestException('That stage does not belong to this project');
    }
    if (dto.inspectorVendorId) await this.requireVendor(dto.inspectorVendorId);
    return this.prisma.propertyInspection.update({
      where: { id: inspectionId },
      data: {
        inspectionType: dto.inspectionType ?? undefined,
        scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : undefined,
        projectId: dto.projectId !== undefined ? dto.projectId || null : undefined,
        stageId: dto.stageId !== undefined ? dto.stageId || null : undefined,
        inspectorVendorId: dto.inspectorVendorId !== undefined ? dto.inspectorVendorId || null : dto.inspectorName ? null : undefined,
        inspectorName: dto.inspectorName !== undefined ? dto.inspectorName : dto.inspectorVendorId ? null : undefined,
      },
    });
  }

  findInspections(propertyId: string) {
    return this.prisma.propertyInspection.findMany({
      where: { propertyId },
      include: { findings: true, inspectorVendor: { select: this.vendorSummarySelect }, stage: { select: { id: true, name: true } } },
      orderBy: { scheduledFor: 'desc' },
    });
  }

  // The nav audit's own finding on the Owner/Admin Sidebar: "Inspections
  // — missing, only inside each property's own page." Same shape
  // findAllMaintenanceRequestsForAccount/findAllLeasesForAccount above
  // already established for this exact category of gap.
  findAllInspectionsForAccount(accountId: string) {
    return this.prisma.propertyInspection.findMany({
      where: { property: { accountId } },
      include: {
        findings: true,
        inspectorVendor: { select: this.vendorSummarySelect },
        property: { select: { id: true, name: true, addressLine: true, city: true, country: true } },
      },
      orderBy: { scheduledFor: 'desc' },
    });
  }

  findInspection(propertyId: string, inspectionId: string) {
    return this.prisma.propertyInspection.findFirst({
      where: { id: inspectionId, propertyId },
      include: { findings: true, inspectorVendor: { select: this.vendorSummarySelect }, stage: { select: { id: true, name: true } } },
    });
  }

  // Findings are only ever written here, alongside the result that
  // depends on them — there's no separate "add one finding at a time"
  // endpoint, so an inspection's findings can't drift out of sync with
  // whether it's still "scheduled".
  async completeInspection(propertyId: string, inspectionId: string, dto: CompleteInspectionDto) {
    const inspection = await this.prisma.propertyInspection.findFirst({ where: { id: inspectionId, propertyId } });
    if (!inspection) throw new NotFoundException('Inspection not found on this property');
    if (inspection.status !== 'scheduled') {
      throw new BadRequestException(`This inspection is already "${inspection.status}"`);
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.propertyInspection.update({
        where: { id: inspectionId },
        data: {
          status: 'completed',
          overallResult: dto.overallResult,
          summary: dto.summary,
          completedAt: new Date(),
          photoUrls: dto.photoUrls ?? [],
        },
      }),
      ...(dto.findings ?? []).map((f) =>
        this.prisma.inspectionFinding.create({
          data: { inspectionId, area: f.area, description: f.description, severity: f.severity ?? 'minor', photoUrls: f.photoUrls ?? [] },
        }),
      ),
    ]);

    await this.prisma.propertyTimelineEvent.create({
      data: {
        propertyId,
        eventType: 'inspection_completed',
        label: `Inspection completed: ${inspection.inspectionType.replace(/_/g, ' ')} — ${dto.overallResult.replace(/_/g, ' ')}`,
      },
    });

    // The "advance" half of the audit's own finding — see
    // PropertyInspection.stageId's own schema comment. Only a real
    // "pass" advances the stage it was actually scheduled against;
    // needs_attention/fail leave the stage exactly where it was, same as
    // if no inspection existed for it at all. Never regresses an
    // already-completed stage back — this only ever moves a stage
    // forward, matching how every other real state transition in this
    // codebase works.
    if (dto.overallResult === 'pass' && inspection.stageId) {
      const stage = await this.prisma.projectStage.findUnique({ where: { id: inspection.stageId } });
      if (stage && stage.status !== 'completed') {
        await this.prisma.projectStage.update({ where: { id: stage.id }, data: { status: 'completed' } });
      }
    }

    return this.findInspection(propertyId, updated.id);
  }

  // Also doubles as "decline" for a buyer-initiated request — a
  // requested inspection that never gets confirmed is functionally the
  // same "no" a scheduled one being cancelled already means, so this
  // reuses the one action rather than adding a separate decline route.
  async cancelInspection(propertyId: string, inspectionId: string) {
    const inspection = await this.prisma.propertyInspection.findFirst({ where: { id: inspectionId, propertyId } });
    if (!inspection) throw new NotFoundException('Inspection not found on this property');
    if (inspection.status !== 'scheduled' && inspection.status !== 'requested') {
      throw new BadRequestException(`This inspection is already "${inspection.status}"`);
    }
    return this.prisma.propertyInspection.update({ where: { id: inspectionId }, data: { status: 'cancelled' } });
  }

  // The owner's side of a buyer-initiated inspection request
  // (ListingsService.requestInspection) — confirming is its own real
  // step, not implicit: a "requested" inspection can't be edited or
  // completed until it flips to "scheduled" here first (updateInspection/
  // completeInspection both still gate on status === 'scheduled',
  // unchanged), so a buyer's requested date can't silently become a
  // confirmed appointment nobody at the property actually agreed to.
  async confirmInspection(propertyId: string, inspectionId: string) {
    const inspection = await this.prisma.propertyInspection.findFirst({ where: { id: inspectionId, propertyId } });
    if (!inspection) throw new NotFoundException('Inspection not found on this property');
    if (inspection.status !== 'requested') {
      throw new BadRequestException(`This inspection is "${inspection.status}" — only a requested inspection can be confirmed`);
    }
    return this.prisma.propertyInspection.update({ where: { id: inspectionId }, data: { status: 'scheduled' } });
  }

  // Module 13. Deliberately not wired to Listing/Offer (Module 5) at all —
  // a lease can just as well start from an owner recording a tenancy that
  // predates this software, same "record what's true" reasoning
  // PropertyValuation's "manual" source already uses.
  async createLease(propertyId: string, dto: CreateLeaseDto) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      include: { account: { select: { currency: true } } },
    });
    if (!property) throw new NotFoundException('Property not found');

    const lease = await this.prisma.lease.create({
      data: {
        propertyId,
        tenantName: dto.tenantName,
        tenantEmail: dto.tenantEmail,
        tenantPhone: dto.tenantPhone,
        rentAmount: dto.rentAmount,
        currency: dto.currency ?? property.account.currency,
        rentFrequency: dto.rentFrequency,
        depositAmount: dto.depositAmount,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        notes: dto.notes,
      },
    });
    await this.prisma.propertyTimelineEvent.create({
      data: {
        propertyId,
        eventType: 'lease_started',
        label: `Lease started: ${dto.tenantName}, ${dto.rentAmount.toLocaleString()} ${lease.currency}/${dto.rentFrequency}`,
      },
    });
    return lease;
  }

  // Closes the "no way to edit a lease's rent/dates once created" gap the
  // README flagged when this module was first built — only while still
  // "active", same reasoning recordRentPayment/endLease already gate on.
  // Empty string clears an existing endDate.
  async updateLease(propertyId: string, leaseId: string, dto: UpdateLeaseDto) {
    const lease = await this.prisma.lease.findFirst({ where: { id: leaseId, propertyId } });
    if (!lease) throw new NotFoundException('Lease not found on this property');
    if (lease.status !== 'active') {
      throw new BadRequestException(`This lease is "${lease.status}" — only an active lease can be edited`);
    }
    return this.prisma.lease.update({
      where: { id: leaseId },
      data: {
        tenantName: dto.tenantName ?? undefined,
        tenantEmail: dto.tenantEmail !== undefined ? dto.tenantEmail : undefined,
        tenantPhone: dto.tenantPhone !== undefined ? dto.tenantPhone : undefined,
        rentAmount: dto.rentAmount ?? undefined,
        rentFrequency: dto.rentFrequency ?? undefined,
        depositAmount: dto.depositAmount ?? undefined,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate !== undefined ? (dto.endDate ? new Date(dto.endDate) : null) : undefined,
        notes: dto.notes !== undefined ? dto.notes : undefined,
      },
    });
  }

  async findLeases(propertyId: string) {
    const leases = await this.prisma.lease.findMany({
      where: { propertyId },
      include: {
        rentPayments: { include: { receipt: true }, orderBy: { periodStart: 'desc' } },
        tenantAccount: { select: { id: true, name: true } },
      },
      orderBy: { startDate: 'desc' },
    });
    return leases.map((lease) => ({
      ...lease,
      upcomingDueDates: lease.status === 'active' ? computeUpcomingRentDueDates(lease) : [],
    }));
  }

  // The nav audit's own finding on the Owner/Admin Sidebar: "Tenants &
  // Leases — missing, only inside each property's own page." Same shape
  // findAllMaintenanceRequestsForAccount above already established for
  // this exact category of gap — join through the owning property, since
  // Lease carries no accountId of its own either.
  async findAllLeasesForAccount(accountId: string) {
    const leases = await this.prisma.lease.findMany({
      where: { property: { accountId } },
      include: {
        rentPayments: { include: { receipt: true }, orderBy: { periodStart: 'desc' } },
        tenantAccount: { select: { id: true, name: true } },
        property: { select: { id: true, name: true, addressLine: true, city: true, country: true } },
      },
      orderBy: { startDate: 'desc' },
    });
    return leases.map((lease) => ({
      ...lease,
      upcomingDueDates: lease.status === 'active' ? computeUpcomingRentDueDates(lease) : [],
    }));
  }

  async findLease(propertyId: string, leaseId: string) {
    const lease = await this.prisma.lease.findFirst({
      where: { id: leaseId, propertyId },
      include: {
        rentPayments: { include: { receipt: true }, orderBy: { periodStart: 'desc' } },
        tenantAccount: { select: { id: true, name: true } },
      },
    });
    if (!lease) return lease;
    return { ...lease, upcomingDueDates: lease.status === 'active' ? computeUpcomingRentDueDates(lease) : [] };
  }

  // The audit's own finding on Workflow 8: "Receipt only attaches to
  // project payments/payouts — LeaseRentPayment has no receipt
  // relation, and no receipt UI appears anywhere in the tenant or owner
  // lease views." accountId is the property's own owning account (the
  // landlord) — the party that actually "received" the rent, same
  // reasoning PaymentsService.releaseMilestone's own receipt uses the
  // vendor's account, not the project's.
  async recordRentPayment(propertyId: string, leaseId: string, dto: RecordRentPaymentDto) {
    const lease = await this.prisma.lease.findFirst({
      where: { id: leaseId, propertyId },
      include: { property: { select: { accountId: true } } },
    });
    if (!lease) throw new NotFoundException('Lease not found on this property');
    if (lease.status !== 'active') {
      throw new BadRequestException(`This lease is "${lease.status}" — no rent to record against it`);
    }
    const currency = dto.currency ?? lease.currency;
    const payment = await this.prisma.leaseRentPayment.create({
      data: {
        leaseId,
        amount: dto.amount,
        currency,
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        method: dto.method ?? 'manual',
        notes: dto.notes,
      },
    });
    const receipt = await this.prisma.receipt.create({
      data: {
        accountId: lease.property.accountId,
        // Not sequential/invoice-grade (a real one would need a
        // per-account counter to avoid gaps) — unique and traceable is
        // enough for this scaffold, same restraint PaymentsService's own
        // receiptNumber() already documents.
        receiptNumber: `RCT-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
        leaseRentPaymentId: payment.id,
        amount: dto.amount,
        currency,
      },
    });
    return { ...payment, receipt };
  }

  async endLease(propertyId: string, leaseId: string, dto: EndLeaseDto) {
    const lease = await this.prisma.lease.findFirst({ where: { id: leaseId, propertyId } });
    if (!lease) throw new NotFoundException('Lease not found on this property');
    if (lease.status !== 'active') {
      throw new BadRequestException(`This lease is already "${lease.status}"`);
    }
    const updated = await this.prisma.lease.update({
      where: { id: leaseId },
      data: { status: dto.status, notes: dto.notes ?? lease.notes, endedAt: new Date() },
    });
    await this.prisma.propertyTimelineEvent.create({
      data: {
        propertyId,
        eventType: 'lease_ended',
        label: `Lease ${dto.status}: ${lease.tenantName}`,
      },
    });
    return updated;
  }

  // Landlord-initiated — for the two cases the automatic path
  // (AccountsService.linkMatchingLeasesForNewTenant, which fires the
  // moment a matching TENANT account is created) can't cover: a lease
  // added *after* the tenant already has an account, or a manual
  // correction. Matches inspectorVendorId/assignedVendorId's own "the
  // owner picks a real account" shape — except there's no marketplace
  // directory to pick a tenant from (unlike Vendor, publicly browsable
  // on purpose), so this resolves by exact email instead: the same
  // tenantEmail already on the lease has to belong to a real User who
  // has already set up their own AccountType.TENANT account (this never
  // creates one on their behalf, same as the automatic path). Once
  // linked, TenantService's own routes become that account's window onto
  // this one lease — see TenantModule.
  async linkTenantAccount(propertyId: string, leaseId: string) {
    const lease = await this.prisma.lease.findFirst({ where: { id: leaseId, propertyId } });
    if (!lease) throw new NotFoundException('Lease not found on this property');
    if (!lease.tenantEmail) {
      throw new BadRequestException('This lease has no tenantEmail on file — set one first (PATCH the lease)');
    }
    const tenantUser = await this.prisma.user.findUnique({ where: { email: lease.tenantEmail } });
    if (!tenantUser) {
      throw new BadRequestException(`No PropertyOnTheGo user is registered with "${lease.tenantEmail}" yet`);
    }
    const tenantMembership = await this.prisma.accountMember.findFirst({
      where: { userId: tenantUser.id, account: { accountType: 'TENANT' } },
    });
    if (!tenantMembership) {
      throw new BadRequestException(`"${lease.tenantEmail}" hasn't set up a tenant account yet`);
    }
    return this.prisma.lease.update({ where: { id: leaseId }, data: { tenantAccountId: tenantMembership.accountId } });
  }

  // Module 12. Same "optional cross-reference must actually belong to
  // this property" check ScheduleInspectionDto.projectId gets.
  async reportMaintenanceRequest(propertyId: string, dto: ReportMaintenanceRequestDto) {
    if (dto.leaseId) {
      const lease = await this.prisma.lease.findFirst({ where: { id: dto.leaseId, propertyId } });
      if (!lease) throw new BadRequestException('That lease does not belong to this property');
    }
    if (dto.assignedVendorId) await this.requireVendor(dto.assignedVendorId);
    return this.prisma.maintenanceRequest.create({
      data: {
        propertyId,
        leaseId: dto.leaseId,
        title: dto.title,
        description: dto.description,
        category: dto.category ?? 'general',
        priority: dto.priority ?? 'normal',
        photoUrls: dto.photoUrls ?? [],
        reportedBy: dto.reportedBy,
        assignedVendorId: dto.assignedVendorId,
        assignedTo: dto.assignedVendorId ? undefined : dto.assignedTo,
      },
      include: { assignedVendor: { select: this.vendorSummarySelect } },
    });
  }

  // Closes the "no way to edit a request's title/description/priority
  // once reported" gap the README flagged when this module was first
  // built — allowed while "open" or "in_progress", the same isOpen shape
  // resolveMaintenanceRequest/cancelMaintenanceRequest already gate on.
  async updateMaintenanceRequest(propertyId: string, requestId: string, dto: UpdateMaintenanceRequestDto) {
    const request = await this.prisma.maintenanceRequest.findFirst({ where: { id: requestId, propertyId } });
    if (!request) throw new NotFoundException('Maintenance request not found on this property');
    if (request.status !== 'open' && request.status !== 'in_progress') {
      throw new BadRequestException(`This request is already "${request.status}" — only an open or in-progress request can be edited`);
    }
    return this.prisma.maintenanceRequest.update({
      where: { id: requestId },
      data: {
        title: dto.title ?? undefined,
        description: dto.description ?? undefined,
        category: dto.category ?? undefined,
        priority: dto.priority ?? undefined,
        photoUrls: dto.photoUrls ?? undefined,
      },
    });
  }

  findMaintenanceRequests(propertyId: string) {
    return this.prisma.maintenanceRequest.findMany({
      where: { propertyId },
      include: { assignedVendor: { select: this.vendorSummarySelect } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // The nav audit's own finding on the Owner/Admin Sidebar: "Maintenance —
  // missing, lives only inside each property's own detail page, no
  // portfolio-wide view." Every maintenance action itself already existed;
  // there was just no way to see every request across every property at
  // once without opening each property one at a time. Same shape
  // findForAccount already uses for documents — join through the owning
  // property rather than a stored accountId, since MaintenanceRequest
  // never carried one.
  findAllMaintenanceRequestsForAccount(accountId: string) {
    return this.prisma.maintenanceRequest.findMany({
      where: { property: { accountId } },
      include: {
        assignedVendor: { select: this.vendorSummarySelect },
        property: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findMaintenanceRequest(propertyId: string, requestId: string) {
    return this.prisma.maintenanceRequest.findFirst({
      where: { id: requestId, propertyId },
      include: { assignedVendor: { select: this.vendorSummarySelect } },
    });
  }

  // The audit's own finding: unlike ProjectMilestone, nothing here ever
  // gated work starting on an explicit sign-off. Own permission
  // (maintenance:approve) — tenant holds maintenance:write to report its
  // own requests but never maintenance:approve, the same self-approval
  // lockout payment:approve/vendor:verify already enforce. Only while
  // "open": once work has started (or the request is resolved/
  // cancelled), a status flip here would just be historical revisionism.
  async setMaintenanceApproval(propertyId: string, requestId: string, dto: SetMaintenanceApprovalDto) {
    const request = await this.prisma.maintenanceRequest.findFirst({ where: { id: requestId, propertyId } });
    if (!request) throw new NotFoundException('Maintenance request not found on this property');
    if (request.status !== 'open') {
      throw new BadRequestException(`This request is already "${request.status}" — approval only applies before work starts`);
    }
    const updated = await this.prisma.maintenanceRequest.update({
      where: { id: requestId },
      data: { approvalStatus: dto.status, approvalNotes: dto.notes },
    });
    if (request.leaseId) {
      const lease = await this.prisma.lease.findUnique({ where: { id: request.leaseId }, select: { tenantAccountId: true } });
      if (lease?.tenantAccountId) {
        this.notifications.notify(
          lease.tenantAccountId,
          'maintenance_approval',
          `Maintenance request ${dto.status}`,
          `"${request.title}" was ${dto.status}${dto.notes ? `: ${dto.notes}` : '.'}`,
          '/tenant',
        );
      }
    }
    return updated;
  }

  // The gate the audit finding above asks for: starting work on an
  // unapproved request used to be indistinguishable from starting work
  // on one nobody ever reviewed — approvalStatus existed nowhere, so
  // there was nothing to check. Mirrors releaseMilestone's own
  // `approvalStatus !== 'approved'` guard exactly.
  async startMaintenanceRequest(propertyId: string, requestId: string, dto: StartMaintenanceRequestDto) {
    const request = await this.prisma.maintenanceRequest.findFirst({ where: { id: requestId, propertyId } });
    if (!request) throw new NotFoundException('Maintenance request not found on this property');
    if (request.status !== 'open') {
      throw new BadRequestException(`This request is already "${request.status}"`);
    }
    if (request.approvalStatus !== 'approved') {
      throw new BadRequestException('This request must be approved before work can start');
    }
    if (dto.assignedVendorId) await this.requireVendor(dto.assignedVendorId);
    return this.prisma.maintenanceRequest.update({
      where: { id: requestId },
      data: {
        status: 'in_progress',
        assignedVendorId: dto.assignedVendorId !== undefined ? dto.assignedVendorId || null : dto.assignedTo ? null : request.assignedVendorId,
        assignedTo: dto.assignedTo !== undefined ? dto.assignedTo : dto.assignedVendorId ? null : request.assignedTo,
      },
    });
  }

  // Module 19 Phase 1's "Maintenance updates" trigger — only on
  // resolution, not start/cancel, the one status change the reporting
  // side actually needs to hear about. Only notifies when the request's
  // own lease has a real linked tenant account (Lease.tenantAccountId) —
  // the same "optional, no forced workflow" gate every other tenant-
  // identity-dependent feature in this codebase already respects; a
  // freeform-only tenant (no lease, or a lease never linked) has nowhere
  // to receive an in-app notification and this silently does nothing for
  // it, not an error.
  async resolveMaintenanceRequest(propertyId: string, requestId: string, dto: ResolveMaintenanceRequestDto) {
    const request = await this.prisma.maintenanceRequest.findFirst({ where: { id: requestId, propertyId } });
    if (!request) throw new NotFoundException('Maintenance request not found on this property');
    if (request.status !== 'open' && request.status !== 'in_progress') {
      throw new BadRequestException(`This request is already "${request.status}"`);
    }
    const updated = await this.prisma.maintenanceRequest.update({
      where: { id: requestId },
      data: {
        status: 'resolved',
        resolutionNotes: dto.resolutionNotes,
        cost: dto.cost,
        resolutionPhotoUrls: dto.resolutionPhotoUrls ?? [],
        resolvedAt: new Date(),
      },
    });
    await this.prisma.propertyTimelineEvent.create({
      data: {
        propertyId,
        eventType: 'maintenance_resolved',
        label: `Maintenance resolved: ${request.title}`,
      },
    });
    if (request.leaseId) {
      const lease = await this.prisma.lease.findUnique({ where: { id: request.leaseId }, select: { tenantAccountId: true } });
      if (lease?.tenantAccountId) {
        this.notifications.notify(
          lease.tenantAccountId,
          'maintenance_resolved',
          'Maintenance request resolved',
          `"${request.title}" has been marked resolved.`,
          '/tenant',
        );
      }
    }
    return updated;
  }

  async cancelMaintenanceRequest(propertyId: string, requestId: string) {
    const request = await this.prisma.maintenanceRequest.findFirst({ where: { id: requestId, propertyId } });
    if (!request) throw new NotFoundException('Maintenance request not found on this property');
    if (request.status !== 'open' && request.status !== 'in_progress') {
      throw new BadRequestException(`This request is already "${request.status}"`);
    }
    return this.prisma.maintenanceRequest.update({ where: { id: requestId }, data: { status: 'cancelled' } });
  }

  // The audit's own finding: PropertyOwner (%-split multi-owner) has
  // existed since Module 1, only ever written as a side-effect of
  // accepting a temporary_ownership development agreement
  // (DevelopmentAgreementsService.applyAccept) — no create/edit endpoint
  // anywhere, and the frontend never rendered property.owners even
  // though GET /properties/:id already fetches it. A PropertyOwner row
  // represents a stake carved OUT of the property's own primary
  // accountId, not a replacement for it — the primary account implicitly
  // holds whatever isn't explicitly split off here, same as how a
  // temporary_ownership agreement's own developer stake works today.
  async addPropertyOwner(propertyId: string, dto: AddPropertyOwnerDto) {
    const property = await this.prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) throw new NotFoundException('Property not found');

    if (dto.ownerType === 'account' && !dto.ownerAccountId) {
      throw new BadRequestException('ownerAccountId is required when ownerType is "account"');
    }
    if (dto.ownerType === 'user' && !dto.ownerUserId) {
      throw new BadRequestException('ownerUserId is required when ownerType is "user"');
    }
    if (dto.ownerType === 'user') {
      // Restricted to a real member of this property's own owning
      // account — "which family member holds this % stake," not an
      // arbitrary user anywhere on the platform. ownerType "account" has
      // no such restriction, matching the development-agreement
      // precedent where the co-owner is a genuinely different account.
      const member = await this.prisma.accountMember.findFirst({
        where: { userId: dto.ownerUserId, accountId: property.accountId },
      });
      if (!member) throw new BadRequestException("That user is not a member of this property's own account");
    }

    const activeTotal = await this.getActiveOwnershipTotal(propertyId);
    if (activeTotal + dto.ownershipPercentage > 100) {
      throw new BadRequestException(
        `Adding ${dto.ownershipPercentage}% would bring shares carved out to other owners to ${(activeTotal + dto.ownershipPercentage).toFixed(2)}% — already ${activeTotal.toFixed(2)}% is held by other owners`,
      );
    }

    return this.prisma.propertyOwner.create({
      data: {
        propertyId,
        ownerType: dto.ownerType,
        ownerAccountId: dto.ownerType === 'account' ? dto.ownerAccountId : null,
        ownerUserId: dto.ownerType === 'user' ? dto.ownerUserId : null,
        ownershipPercentage: dto.ownershipPercentage,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
  }

  // Sum of every currently-active (no endDate, or one still in the
  // future) co-owner share on this property — the same "compute on
  // read" restraint this codebase already applies elsewhere (project
  // spend, vendor trust score) rather than a stored running total that
  // would drift the moment a stake is added, edited, or ends.
  private async getActiveOwnershipTotal(propertyId: string, excludeOwnerId?: string) {
    const now = new Date();
    const owners = await this.prisma.propertyOwner.findMany({
      where: {
        propertyId,
        id: excludeOwnerId ? { not: excludeOwnerId } : undefined,
        OR: [{ endDate: null }, { endDate: { gt: now } }],
      },
      select: { ownershipPercentage: true },
    });
    return owners.reduce((sum, o) => sum + Number(o.ownershipPercentage), 0);
  }

  async updatePropertyOwner(propertyId: string, ownerId: string, dto: UpdatePropertyOwnerDto) {
    const owner = await this.prisma.propertyOwner.findFirst({ where: { id: ownerId, propertyId } });
    if (!owner) throw new NotFoundException('Owner not found on this property');
    if (dto.ownershipPercentage != null) {
      const activeTotal = await this.getActiveOwnershipTotal(propertyId, ownerId);
      if (activeTotal + dto.ownershipPercentage > 100) {
        throw new BadRequestException(
          `Raising this owner's share to ${dto.ownershipPercentage}% would bring shares carved out to other owners to ${(activeTotal + dto.ownershipPercentage).toFixed(2)}%`,
        );
      }
    }
    return this.prisma.propertyOwner.update({
      where: { id: ownerId },
      data: {
        ownershipPercentage: dto.ownershipPercentage ?? undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
  }

  // A hard delete, not just setting endDate — correcting a mistaken
  // entry is a different real action from a stake genuinely ending on a
  // real date, the same distinction cancelMaintenanceRequest's own
  // status vs. a real edit already draws.
  async removePropertyOwner(propertyId: string, ownerId: string) {
    const owner = await this.prisma.propertyOwner.findFirst({ where: { id: ownerId, propertyId } });
    if (!owner) throw new NotFoundException('Owner not found on this property');
    await this.prisma.propertyOwner.delete({ where: { id: ownerId } });
    return { deleted: true };
  }
}
