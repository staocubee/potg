import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { AddMilestoneDto } from './dto/add-milestone.dto';
import { AddBoqItemDto } from './dto/add-boq-item.dto';
import { AddProjectUpdateDto } from './dto/add-project-update.dto';
import { RequestQuoteDto } from './dto/request-quote.dto';
import { UpdateProjectStageDto } from './dto/update-project-stage.dto';
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

  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        stages: { orderBy: { sortOrder: 'asc' } },
        milestones: { orderBy: { createdAt: 'asc' } },
        updates: { orderBy: { createdAt: 'desc' } },
        quotes: { include: { vendor: true }, orderBy: { amount: 'asc' } },
        assignments: { include: { vendor: true } },
        reviews: true,
        contract: { include: { vendor: { select: { businessName: true } } } },
        boqItems: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!project) return project;
    const onHoldMilestoneIds = await this.getOnHoldMilestoneIds(id);
    return {
      ...project,
      ...(await this.getSpend(id)),
      milestones: project.milestones.map((m) => ({ ...m, onHold: onHoldMilestoneIds.has(m.id) })),
    };
  }

  // The audit's own finding on Workflow 9: "Payment may be placed on
  // hold — real enforcement, but implicit... an open dispute just
  // blocks releaseMilestone/refundPayment as a side-effect guard, not a
  // first-class hold state." Computed live from the same open/
  // under_review disputes releaseMilestone itself checks — not a stored
  // status this codebase would then have to keep in sync with every
  // place a dispute opens or resolves, same "compute on read" restraint
  // getSpend above already uses.
  private async getOnHoldMilestoneIds(projectId: string) {
    const disputes = await this.prisma.dispute.findMany({
      where: { projectId, milestoneId: { not: null }, status: { in: ['open', 'under_review'] } },
      select: { milestoneId: true },
    });
    return new Set(disputes.map((d) => d.milestoneId!));
  }

  // The audit's own finding: "Project.budget is a static number set at
  // creation, only ever read for AI comparison — nothing decrements it
  // against real spend." Computed live on every read, not a stored,
  // mutable running total this codebase would then have to keep in sync
  // across every place money actually moves — same "compute on read"
  // restraint the document checklist and vendor trust score already use
  // for exactly this reason. Two real spend sources, summed separately
  // so the breakdown means something, not just a total:
  //  - Payout.grossAmount — the milestone's own full paymentAmount, i.e.
  //    what's actually debited from escrow (see Payout's own schema
  //    comment: this is "the owner's real project cost", unaffected by
  //    the platform fee that only reduces the vendor's own take-home) —
  //    only counting status 'paid': pending/processing money hasn't left
  //    escrow yet and 'failed' never left it at all, so summing every
  //    status (as a first pass here did) overcounts spend by exactly the
  //    stalled/failed test payouts this project happens to carry.
  //  - Order.totalAmount for every materials order tied to this project,
  //    excluding cancelled ones — a cancelled order was never really
  //    spent against.
  private async getSpend(projectId: string) {
    const [payouts, orders] = await Promise.all([
      this.prisma.payout.aggregate({ where: { projectId, status: 'paid' }, _sum: { grossAmount: true } }),
      this.prisma.order.aggregate({ where: { projectId, status: { not: 'cancelled' } }, _sum: { totalAmount: true } }),
    ]);
    const milestonesReleased = payouts._sum.grossAmount ?? 0;
    const materialsSpent = orders._sum.totalAmount ?? 0;
    const totalSpent = Number(milestonesReleased) + Number(materialsSpent);
    return {
      milestonesReleased,
      materialsSpent,
      totalSpent,
    };
  }

  // The gap the Reports & Permissions audit flagged: ProjectStage.status
  // was set once at creation (create() above) and never writable again —
  // no endpoint anywhere let the "Scope -> Quote -> Materials -> Work ->
  // Handover" sequence actually advance. Reachable by the owning account
  // (project:update_progress) or, via @AllowAssignedVendor() on the
  // controller route, by a vendor genuinely hired onto this project — the
  // person actually doing the work is usually the one who knows a stage
  // just finished.
  // The audit's own finding on Workflows 3 & 4: "PropertyInspection.
  // projectId links the two, but nothing wires an inspection's result to
  // gate or advance a stage — they're independently updated, no
  // automatic connection" / "'Handover' is just one more seeded stage
  // name — no distinct sign-off/final-inspection logic." Originally
  // scoped to just Handover, on purpose — extending a blanket "every
  // stage needs an inspection" rule to every existing project's own
  // already-completed stages would have been inventing a requirement
  // this blueprint never asked for. PropertyInspection.stageId (a later
  // pass) makes the fuller version safe: a real, explicit link, opt-in
  // per stage. A stage nobody ever scheduled an inspection against
  // completes exactly as it always has — zero regression for any
  // existing project. Only once someone actually links a real
  // inspection to a specific stage does that stage gain a real gate,
  // the same one Handover already had, generalized rather than
  // duplicated. Handover's own original project-wide fallback stays
  // exactly as it was, for the (still very real) case of an inspection
  // never explicitly tied to any one stage.
  async updateStage(projectId: string, stageId: string, dto: UpdateProjectStageDto) {
    const stage = await this.prisma.projectStage.findFirst({ where: { id: stageId, projectId } });
    if (!stage) throw new NotFoundException('Stage not found on this project');
    if (dto.status === 'completed') {
      const linkedInspection = await this.prisma.propertyInspection.findFirst({ where: { stageId } });
      if (linkedInspection) {
        const passingLinked = await this.prisma.propertyInspection.findFirst({
          where: { stageId, status: 'completed', overallResult: 'pass' },
        });
        if (!passingLinked) {
          throw new BadRequestException(
            `An inspection is scheduled against this stage but hasn't passed yet — it must be completed with a "pass" result before "${stage.name}" can be marked complete`,
          );
        }
      } else if (stage.name === 'Handover') {
        const passingInspection = await this.prisma.propertyInspection.findFirst({
          where: { projectId, status: 'completed', overallResult: 'pass' },
        });
        if (!passingInspection) {
          throw new BadRequestException(
            'Handover requires a completed inspection on this project with a "pass" result before it can be marked complete',
          );
        }
      }
    }
    return this.prisma.projectStage.update({ where: { id: stageId }, data: { status: dto.status } });
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

  addBoqItem(projectId: string, dto: AddBoqItemDto) {
    return this.prisma.projectBoqItem.create({
      data: {
        projectId,
        description: dto.description,
        quantity: dto.quantity,
        unit: dto.unit,
        estimatedUnitCost: dto.estimatedUnitCost,
      },
    });
  }

  async removeBoqItem(projectId: string, itemId: string) {
    const item = await this.prisma.projectBoqItem.findFirst({ where: { id: itemId, projectId } });
    if (!item) throw new NotFoundException('BOQ item not found on this project');
    await this.prisma.projectBoqItem.delete({ where: { id: itemId } });
    return { deleted: true };
  }

  // Module 19 Phase 1's "Project updates" trigger. Originally owner-only
  // (project:write was never granted to the vendor role, so there was no
  // "which side posted it" ambiguity — every update notified every vendor
  // assigned to the project). Now reachable by an assigned vendor too, via
  // project:update_progress + @AllowAssignedVendor() on the controller
  // route, so notification direction has to be decided by who's actually
  // posting: the owning account notifies its assigned vendors as before;
  // an assigned vendor instead notifies the owning account.
  async addUpdate(
    projectId: string,
    submittedByUserId: string,
    submittedByAccountId: string,
    dto: AddProjectUpdateDto,
  ) {
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
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { title: true, accountId: true },
    });
    if (submittedByAccountId === project?.accountId) {
      const assignments = await this.prisma.projectVendorAssignment.findMany({
        where: { projectId },
        select: { vendor: { select: { accountId: true } } },
      });
      for (const assignment of assignments) {
        this.notifications.notify(
          assignment.vendor.accountId,
          'project_update',
          `New update on ${project?.title ?? 'a project'}`,
          dto.description,
          `/vendors/me`,
        );
      }
    } else if (project) {
      this.notifications.notify(
        project.accountId,
        'project_update',
        `New update on ${project.title}`,
        dto.description,
        `/projects/${projectId}`,
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

  // The audit's own finding on Workflow 5: "Milestones (title/amount/
  // due date) are fully real. No Contract model exists anywhere — a
  // 'contract' here is nothing more than the freeform scope description
  // plus milestones, no binding-terms artifact." Deliberately not
  // triggered automatically by acceptQuote above — no milestones exist
  // yet at that point, and a contract with an empty terms list wouldn't
  // be one. A real, separate, human-invoked action once both real
  // preconditions this codebase already tracks are true: a vendor
  // actually assigned (ProjectVendorAssignment), and at least one real
  // milestone. Snapshots rather than computing on read (the restraint
  // getSpend/getOnHoldMilestoneIds above use) on purpose — a contract
  // freezes what was agreed to, it doesn't keep reflecting whatever the
  // project's own mutable state says later.
  async generateContract(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { assignments: true, milestones: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    const existing = await this.prisma.projectContract.findUnique({ where: { projectId } });
    if (existing) throw new ConflictException('This project already has a contract');

    const primary = project.assignments.find((a) => a.role === 'primary_contractor') ?? project.assignments[0];
    if (!primary) {
      throw new BadRequestException('This project has no vendor assigned yet — accept a quote first');
    }
    if (project.milestones.length === 0) {
      throw new BadRequestException('This project has no milestones yet — add at least one before generating a contract');
    }

    const totalAmount = project.milestones.reduce((sum, m) => sum + Number(m.paymentAmount ?? 0), 0);
    const milestonesSnapshot = project.milestones.map((m) => ({
      title: m.title,
      description: m.description,
      paymentAmount: m.paymentAmount != null ? Number(m.paymentAmount) : null,
      dueDate: m.dueDate,
    }));

    return this.prisma.projectContract.create({
      data: {
        projectId,
        vendorId: primary.vendorId,
        scopeDescription: project.scopeDescription,
        totalAmount,
        currency: project.currency,
        milestonesSnapshot,
      },
      include: { vendor: { select: { businessName: true } } },
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
