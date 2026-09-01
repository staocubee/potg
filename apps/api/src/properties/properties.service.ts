import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { CreateValuationDto } from './dto/create-valuation.dto';

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
}
