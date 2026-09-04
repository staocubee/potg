import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReportTenantMaintenanceRequestDto } from './dto/report-tenant-maintenance-request.dto';

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
        rentPayments: { orderBy: { periodStart: 'desc' } },
      },
    });
    return lease;
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
        priority: dto.priority ?? 'normal',
        reportedBy: lease.tenantName,
      },
    });
  }
}
