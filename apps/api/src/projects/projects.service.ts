import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { AddMilestoneDto } from './dto/add-milestone.dto';
import { AddProjectUpdateDto } from './dto/add-project-update.dto';
import { RequestQuoteDto } from './dto/request-quote.dto';
import { InAppNotificationsService } from '../notifications/in-app-notifications.service';

// Matches the wireframe's RenovationProject artboard exactly — a project
// always starts at this sequence, with Scope the only stage already under
// way (the owner had to describe scope to create the project at all).
const DEFAULT_STAGES = ['Scope', 'Quote', 'Materials', 'Work', 'Handover'];

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: InAppNotificationsService,
  ) {}

  async create(accountId: string, dto: CreateProjectDto) {
    const property = await this.prisma.property.findFirst({
      where: { id: dto.propertyId, accountId },
      include: { account: { select: { currency: true } } },
    });
    if (!property) throw new NotFoundException('Property not found');

    const project = await this.prisma.project.create({
      data: {
        accountId,
        propertyId: dto.propertyId,
        projectType: dto.projectType,
        title: dto.title,
        scopeDescription: dto.scopeDescription,
        budget: dto.budget,
        currency: dto.currency ?? property.account.currency,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        expectedEndDate: dto.expectedEndDate ? new Date(dto.expectedEndDate) : undefined,
      },
    });

    await this.prisma.projectStage.createMany({
      data: DEFAULT_STAGES.map((name, i) => ({
        projectId: project.id,
        name,
        sortOrder: i,
        status: i === 0 ? 'in_progress' : 'not_started',
      })),
    });

    await this.prisma.propertyTimelineEvent.create({
      data: {
        propertyId: dto.propertyId,
        eventType: 'project_started',
        label: `Project started: ${dto.title}`,
      },
    });

    return project;
  }

  findAllForAccount(accountId: string) {
    return this.prisma.project.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      include: { stages: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  findOne(id: string) {
    return this.prisma.project.findUnique({
      where: { id },
      include: {
        stages: { orderBy: { sortOrder: 'asc' } },
        milestones: { orderBy: { createdAt: 'asc' } },
        updates: { orderBy: { createdAt: 'desc' } },
        quotes: { include: { vendor: true }, orderBy: { amount: 'asc' } },
        assignments: { include: { vendor: true } },
        reviews: true,
      },
    });
  }

  addMilestone(projectId: string, dto: AddMilestoneDto) {
    return this.prisma.projectMilestone.create({
      data: {
        projectId,
        title: dto.title,
        description: dto.description,
        paymentAmount: dto.paymentAmount,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });
  }

  // Module 19 Phase 1's "Project updates" trigger — every route that
  // reaches this (the owner-side POST, and the AI accept-chain for
  // draft_project_status_update) is owner-authored: project:write is
  // never granted to the vendor role, so there's no "which side posted
  // it" ambiguity here the way a two-sided feature like disputes has —
  // an update always notifies every vendor assigned to the project, never
  // the owner's own account.
  async addUpdate(projectId: string, submittedByUserId: string, dto: AddProjectUpdateDto) {
    if (dto.milestoneId) {
      const milestone = await this.prisma.projectMilestone.findFirst({
        where: { id: dto.milestoneId, projectId },
      });
      if (!milestone) throw new NotFoundException('Milestone not found on this project');
    }
    const update = await this.prisma.projectUpdate.create({
      data: {
        projectId,
        submittedByUserId,
        milestoneId: dto.milestoneId,
        description: dto.description,
        mediaUrls: dto.mediaUrls ?? [],
      },
    });
    const [project, assignments] = await Promise.all([
      this.prisma.project.findUnique({ where: { id: projectId }, select: { title: true } }),
      this.prisma.projectVendorAssignment.findMany({ where: { projectId }, select: { vendor: { select: { accountId: true } } } }),
    ]);
    for (const assignment of assignments) {
      this.notifications.notify(
        assignment.vendor.accountId,
        'project_update',
        `New update on ${project?.title ?? 'a project'}`,
        dto.description,
        `/vendors/me`,
      );
    }
    return update;
  }

  // Owner-initiated: invite a specific vendor to quote. Vendors respond (or
  // submit unsolicited) via POST /vendors/me/quotes.
  async requestQuote(projectId: string, dto: RequestQuoteDto) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: dto.vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const existing = await this.prisma.vendorQuote.findFirst({
      where: { projectId, vendorId: dto.vendorId },
    });
    if (existing) return existing;

    return this.prisma.vendorQuote.create({
      data: { projectId, vendorId: dto.vendorId, amount: 0, status: 'requested' },
    });
  }

  // Accepting a quote is the moment a project gets its hired vendor —
  // creates the assignment, declines the project's other live quotes, and
  // advances the project past "Quote" if it's still in planning.
  async acceptQuote(projectId: string, quoteId: string) {
    const quote = await this.prisma.vendorQuote.findFirst({ where: { id: quoteId, projectId } });
    if (!quote) throw new NotFoundException('Quote not found on this project');
    if (quote.status === 'requested') {
      throw new BadRequestException('This quote has not been submitted yet — nothing to accept');
    }

    await this.prisma.$transaction([
      this.prisma.vendorQuote.update({ where: { id: quoteId }, data: { status: 'accepted' } }),
      this.prisma.vendorQuote.updateMany({
        where: { projectId, id: { not: quoteId }, status: { in: ['submitted', 'requested'] } },
        data: { status: 'declined' },
      }),
      this.prisma.projectVendorAssignment.upsert({
        where: { projectId_vendorId: { projectId, vendorId: quote.vendorId } },
        update: {},
        create: { projectId, vendorId: quote.vendorId, role: 'primary_contractor' },
      }),
      this.prisma.project.updateMany({
        where: { id: projectId, status: 'planning' },
        data: { status: 'in_progress' },
      }),
    ]);

    return this.prisma.project.findUnique({
      where: { id: projectId },
      include: { assignments: { include: { vendor: true } } },
    });
  }

  // The gate VendorsService.createReview checks before letting an owner
  // review a vendor (Section 8's implicit "review after the fact" pattern
  // — you can't rate work that hasn't finished). Deliberately just a status
  // flip: this scaffold doesn't model a handover/sign-off workflow beyond
  // the "Handover" stage name already in DEFAULT_STAGES.
  async complete(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.status === 'completed') {
      throw new BadRequestException('This project is already marked completed');
    }
    if (project.status === 'cancelled') {
      throw new BadRequestException('A cancelled project cannot be marked completed');
    }
    return this.prisma.project.update({ where: { id: projectId }, data: { status: 'completed' } });
  }
}
