import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { CreateValuationDto } from './dto/create-valuation.dto';
import { ScheduleInspectionDto } from './dto/schedule-inspection.dto';
import { CompleteInspectionDto } from './dto/complete-inspection.dto';

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
}
