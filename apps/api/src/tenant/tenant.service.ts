import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReportTenantMaintenanceRequestDto } from './dto/report-tenant-maintenance-request.dto';
import { PayRentScheduleEntryDto } from './dto/pay-rent-schedule-entry.dto';

// The tenant-facing counterpart to PropertiesService's landlord-facing
// lease/maintenance routes — deliberately its own module rather than
// more routes on PropertiesController, since every route here is scoped
// by "whichever lease this account is linked to," never by :propertyId
// (a tenant doesn't own the property, so PermissionsGuard's :propertyId
// ABAC would 404 it out of the landlord-facing routes entirely — see
// PropertiesController's own comment on why :propertyId is the param
// name it deliberately uses). Same shape VendorsController's own `me`
// routes give a vendor account: everything here reads "my own thing,"
// never an id the caller supplies.
@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  // Shared by every method below — a tenant account with no linked lease
  // yet (PropertiesService.linkTenantAccount not called on any lease)
  // has nothing to show. 404, not an empty object: same "don't pretend
  // there's a resource" reasoning PermissionsGuard's own :propertyId
  // check already uses.
  private async requireMyLease(accountId: string) {
    const lease = await this.prisma.lease.findFirst({ where: { tenantAccountId: accountId } });
    if (!lease) {
      throw new NotFoundException('No lease is linked to this account yet — ask your landlord to link it');
    }
    return lease;
  }

  async findMyLease(accountId: string) {
    const lease = await this.prisma.lease.findFirst({
      where: { tenantAccountId: accountId },
      include: {
        property: { select: { id: true, name: true, addressLine: true, city: true, country: true } },
        rentPayments: { include: { receipt: true }, orderBy: { periodStart: 'desc' } },
        scheduleEntries: { orderBy: { dueDate: 'asc' } },
      },
    });
    if (!lease) return lease;
    // Real, persisted due dates — same real rows PropertiesService's own
    // landlord-facing routes read, not a fresh computation. Tenant view is
    // read-only here (no adjust/skip route on this controller), matching
    // the established owner-editable/tenant-read-only asymmetry used
    // elsewhere (e.g. the Rent Payments row itself).
    const upcomingDueDates =
      lease.status === 'active' ? lease.scheduleEntries.filter((e) => e.status === 'due').map((e) => e.dueDate.toISOString()) : [];
    return { ...lease, upcomingDueDates };
  }

  async findMyMaintenanceRequests(accountId: string) {
    const lease = await this.requireMyLease(accountId);
    return this.prisma.maintenanceRequest.findMany({
      where: { leaseId: lease.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Only documents the landlord actually tagged to this lease (Document.
  // leaseId — see its own schema comment) — never the landlord's full
  // document vault. A tenant sees nothing here until the landlord
  // uploads something and picks their lease for it.
  async findMyDocuments(accountId: string) {
    const lease = await this.requireMyLease(accountId);
    return this.prisma.document.findMany({
      where: { leaseId: lease.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  // "Community management," the tenant-facing read half — see
  // PropertyAnnouncement's own schema comment for the full scoping
  // reasoning. Reuses lease:read, same as findMyLease, not a new
  // permission — an announcement is landlord-to-tenant content about the
  // exact same tenancy that permission already gates. A tenant sees
  // exactly two kinds: one scoped to its own leased property, and any
  // portfolio-wide one (propertyId null) from the same account that owns
  // that property — never another landlord's account, and never another
  // property's own announcement.
  async findMyAnnouncements(accountId: string) {
    const lease = await this.requireMyLease(accountId);
    const property = await this.prisma.property.findUniqueOrThrow({
      where: { id: lease.propertyId },
      select: { accountId: true },
    });
    return this.prisma.propertyAnnouncement.findMany({
      where: { OR: [{ propertyId: lease.propertyId }, { propertyId: null, accountId: property.accountId }] },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Reuses PropertiesService's own model shape (propertyId/leaseId set
  // from the lease, not client-supplied) but doesn't call
  // PropertiesService.reportMaintenanceRequest directly — that method
  // takes a DTO shaped for the landlord's own richer form (assignedTo/
  // assignedVendorId/leaseId as optional client input), which a tenant
  // should never get to set.
  async reportMaintenanceRequest(accountId: string, dto: ReportTenantMaintenanceRequestDto) {
    const lease = await this.requireMyLease(accountId);
    return this.prisma.maintenanceRequest.create({
      data: {
        propertyId: lease.propertyId,
        leaseId: lease.id,
        title: dto.title,
        description: dto.description,
        category: dto.category ?? 'general',
        priority: dto.priority ?? 'normal',
        photoUrls: dto.photoUrls ?? [],
        reportedBy: lease.tenantName,
      },
    });
  }

  // The audit's own finding on Workflow 8: "Tenant pays rent — not
  // self-service at all." Deliberately narrower than
  // PropertiesService.recordRentPayment, which this doesn't call —
  // TenantController's own comment already explains why this module
  // never reaches across into PropertiesService — a tenant can only ever
  // pay a real, already-landlord-set entry on its own lease, never a
  // free-form amount/date range: `entry.amount`/`entry.currency`/
  // `entry.dueDate` are what gets recorded, not client input, so
  // `lease:pay` can't be used to fabricate a payment the landlord's own
  // schedule never asked for. Same simulated "manual" ledger record
  // recordRentPayment already creates by default — this doesn't move any
  // money either, same restraint the schema's own comment on
  // LeaseRentPayment already states.
  async payRentScheduleEntry(accountId: string, entryId: string, dto: PayRentScheduleEntryDto) {
    const lease = await this.requireMyLease(accountId);
    if (lease.status !== 'active') {
      throw new BadRequestException(`This lease is "${lease.status}" — no rent due`);
    }
    const entry = await this.prisma.leaseRentScheduleEntry.findFirst({ where: { id: entryId, leaseId: lease.id } });
    if (!entry) throw new NotFoundException('Schedule entry not found on your lease');
    if (entry.status !== 'due') {
      throw new BadRequestException(`This entry is already "${entry.status}" — only a due entry can be paid`);
    }
    const property = await this.prisma.property.findUniqueOrThrow({
      where: { id: lease.propertyId },
      select: { accountId: true },
    });
    const payment = await this.prisma.leaseRentPayment.create({
      data: {
        leaseId: lease.id,
        amount: entry.amount,
        currency: entry.currency,
        periodStart: entry.dueDate,
        periodEnd: entry.dueDate,
        method: 'tenant_self_service',
        notes: dto.notes,
        scheduleEntryId: entry.id,
      },
    });
    await this.prisma.leaseRentScheduleEntry.update({ where: { id: entry.id }, data: { status: 'paid' } });
    const receipt = await this.prisma.receipt.create({
      data: {
        accountId: property.accountId,
        receiptNumber: `RCT-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
        leaseRentPaymentId: payment.id,
        amount: entry.amount,
        currency: entry.currency,
      },
    });
    return { ...payment, receipt };
  }
}
