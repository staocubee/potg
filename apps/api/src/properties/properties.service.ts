import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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

@Injectable()
export class PropertiesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(accountId: string, dto: CreatePropertyDto) {
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
    return property;
  }

  findAllForAccount(accountId: string) {
    return this.prisma.property.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string) {
    return this.prisma.property.findUnique({
      where: { id },
      include: {
        owners: true,
        documents: true,
        timelineEvents: { orderBy: { occurredAt: 'asc' } },
      },
    });
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
    return this.prisma.propertyInspection.create({
      data: {
        propertyId,
        projectId: dto.projectId,
        inspectionType: dto.inspectionType,
        scheduledFor: new Date(dto.scheduledFor),
        inspectorName: dto.inspectorName,
      },
    });
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
    return this.prisma.propertyInspection.update({
      where: { id: inspectionId },
      data: {
        inspectionType: dto.inspectionType ?? undefined,
        scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : undefined,
        projectId: dto.projectId !== undefined ? dto.projectId || null : undefined,
        inspectorName: dto.inspectorName !== undefined ? dto.inspectorName : undefined,
      },
    });
  }

  findInspections(propertyId: string) {
    return this.prisma.propertyInspection.findMany({
      where: { propertyId },
      include: { findings: true },
      orderBy: { scheduledFor: 'desc' },
    });
  }

  findInspection(propertyId: string, inspectionId: string) {
    return this.prisma.propertyInspection.findFirst({
      where: { id: inspectionId, propertyId },
      include: { findings: true },
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
        data: { status: 'completed', overallResult: dto.overallResult, summary: dto.summary, completedAt: new Date() },
      }),
      ...(dto.findings ?? []).map((f) =>
        this.prisma.inspectionFinding.create({
          data: { inspectionId, area: f.area, description: f.description, severity: f.severity ?? 'minor' },
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

    return this.findInspection(propertyId, updated.id);
  }

  async cancelInspection(propertyId: string, inspectionId: string) {
    const inspection = await this.prisma.propertyInspection.findFirst({ where: { id: inspectionId, propertyId } });
    if (!inspection) throw new NotFoundException('Inspection not found on this property');
    if (inspection.status !== 'scheduled') {
      throw new BadRequestException(`This inspection is already "${inspection.status}"`);
    }
    return this.prisma.propertyInspection.update({ where: { id: inspectionId }, data: { status: 'cancelled' } });
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

  findLeases(propertyId: string) {
    return this.prisma.lease.findMany({
      where: { propertyId },
      include: { rentPayments: { orderBy: { periodStart: 'desc' } } },
      orderBy: { startDate: 'desc' },
    });
  }

  findLease(propertyId: string, leaseId: string) {
    return this.prisma.lease.findFirst({
      where: { id: leaseId, propertyId },
      include: { rentPayments: { orderBy: { periodStart: 'desc' } } },
    });
  }

  async recordRentPayment(propertyId: string, leaseId: string, dto: RecordRentPaymentDto) {
    const lease = await this.prisma.lease.findFirst({ where: { id: leaseId, propertyId } });
    if (!lease) throw new NotFoundException('Lease not found on this property');
    if (lease.status !== 'active') {
      throw new BadRequestException(`This lease is "${lease.status}" — no rent to record against it`);
    }
    return this.prisma.leaseRentPayment.create({
      data: {
        leaseId,
        amount: dto.amount,
        currency: dto.currency ?? lease.currency,
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        method: dto.method ?? 'manual',
        notes: dto.notes,
      },
    });
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

  // Module 12. Same "optional cross-reference must actually belong to
  // this property" check ScheduleInspectionDto.projectId gets.
  async reportMaintenanceRequest(propertyId: string, dto: ReportMaintenanceRequestDto) {
    if (dto.leaseId) {
      const lease = await this.prisma.lease.findFirst({ where: { id: dto.leaseId, propertyId } });
      if (!lease) throw new BadRequestException('That lease does not belong to this property');
    }
    return this.prisma.maintenanceRequest.create({
      data: {
        propertyId,
        leaseId: dto.leaseId,
        title: dto.title,
        description: dto.description,
        priority: dto.priority ?? 'normal',
        reportedBy: dto.reportedBy,
        assignedTo: dto.assignedTo,
      },
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
        priority: dto.priority ?? undefined,
      },
    });
  }

  findMaintenanceRequests(propertyId: string) {
    return this.prisma.maintenanceRequest.findMany({
      where: { propertyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findMaintenanceRequest(propertyId: string, requestId: string) {
    return this.prisma.maintenanceRequest.findFirst({ where: { id: requestId, propertyId } });
  }

  async startMaintenanceRequest(propertyId: string, requestId: string, dto: StartMaintenanceRequestDto) {
    const request = await this.prisma.maintenanceRequest.findFirst({ where: { id: requestId, propertyId } });
    if (!request) throw new NotFoundException('Maintenance request not found on this property');
    if (request.status !== 'open') {
      throw new BadRequestException(`This request is already "${request.status}"`);
    }
    return this.prisma.maintenanceRequest.update({
      where: { id: requestId },
      data: { status: 'in_progress', assignedTo: dto.assignedTo ?? request.assignedTo },
    });
  }

  async resolveMaintenanceRequest(propertyId: string, requestId: string, dto: ResolveMaintenanceRequestDto) {
    const request = await this.prisma.maintenanceRequest.findFirst({ where: { id: requestId, propertyId } });
    if (!request) throw new NotFoundException('Maintenance request not found on this property');
    if (request.status !== 'open' && request.status !== 'in_progress') {
      throw new BadRequestException(`This request is already "${request.status}"`);
    }
    const updated = await this.prisma.maintenanceRequest.update({
      where: { id: requestId },
      data: { status: 'resolved', resolutionNotes: dto.resolutionNotes, resolvedAt: new Date() },
    });
    await this.prisma.propertyTimelineEvent.create({
      data: {
        propertyId,
        eventType: 'maintenance_resolved',
        label: `Maintenance resolved: ${request.title}`,
      },
    });
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
}
