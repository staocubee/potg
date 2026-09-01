import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DepositDto } from './dto/deposit.dto';
import { RaiseDisputeDto } from './dto/raise-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';

function receiptNumber(): string {
  // Not sequential/invoice-grade (a real one would need a per-account
  // counter to avoid gaps) — unique and traceable is enough for this
  // scaffold.
  return `RCT-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  private async getOrCreateEscrowAccount(projectId: string, currency: string) {
    const existing = await this.prisma.escrowAccount.findUnique({ where: { projectId } });
    if (existing) return existing;
    return this.prisma.escrowAccount.create({ data: { projectId, currency } });
  }

  async getEscrow(projectId: string) {
    const escrowAccount = await this.prisma.escrowAccount.findUnique({
      where: { projectId },
      include: { ledgerEntries: { orderBy: { createdAt: 'desc' } } },
    });
    if (!escrowAccount) {
      // Not funded yet — a real 404 would be confusing here since it's a
      // perfectly normal state for a new project, not a missing resource.
      return { projectId, balance: 0, currency: null, status: 'not_funded', ledgerEntries: [] };
    }
    return escrowAccount;
  }

  // Deposit — simulated (see the Payment model's schema comment). Funds
  // the project's escrow account, which is created on first deposit.
  async deposit(accountId: string, projectId: string, dto: DepositDto) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, accountId } });
    if (!project) throw new NotFoundException('Project not found');

    const currency = dto.currency ?? project.currency;
    const escrowAccount = await this.getOrCreateEscrowAccount(projectId, currency);
    const newBalance = Number(escrowAccount.balance) + dto.amount;

    const [payment] = await this.prisma.$transaction([
      this.prisma.payment.create({
        data: {
          accountId,
          projectId,
          escrowAccountId: escrowAccount.id,
          amount: dto.amount,
          currency,
          provider: dto.provider ?? 'manual',
          providerReference: dto.providerReference,
          status: 'completed',
        },
      }),
      this.prisma.escrowAccount.update({ where: { id: escrowAccount.id }, data: { balance: newBalance } }),
    ]);

    await this.prisma.escrowLedgerEntry.create({
      data: {
        escrowAccountId: escrowAccount.id,
        entryType: 'deposit',
        amount: dto.amount,
        balanceAfter: newBalance,
        relatedPaymentId: payment.id,
        notes: `Deposit via ${payment.provider}`,
      },
    });
    const receipt = await this.prisma.receipt.create({
      data: {
        accountId,
        receiptNumber: receiptNumber(),
        paymentId: payment.id,
        amount: dto.amount,
        currency,
      },
    });

    return { payment, receipt };
  }

  findPayments(projectId: string) {
    return this.prisma.payment.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
  }

  // Owner marks a milestone's submitted evidence as approved — the
  // prerequisite for releasing funds, kept as its own step per Section 22's
  // "clear approval flows: review evidence, approve ... hold payment".
  async approveMilestone(projectId: string, milestoneId: string) {
    const milestone = await this.prisma.projectMilestone.findFirst({ where: { id: milestoneId, projectId } });
    if (!milestone) throw new NotFoundException('Milestone not found on this project');
    return this.prisma.projectMilestone.update({
      where: { id: milestoneId },
      data: { approvalStatus: 'approved' },
    });
  }

  // Releasing a milestone is the one action in this module gated by
  // "payment:approve" rather than a plain read/write permission — moving
  // money out of escrow deserves its own permission, not just whichever
  // role can edit a project.
  async releaseMilestone(projectId: string, milestoneId: string) {
    const milestone = await this.prisma.projectMilestone.findFirst({ where: { id: milestoneId, projectId } });
    if (!milestone) throw new NotFoundException('Milestone not found on this project');
    if (milestone.approvalStatus !== 'approved') {
      throw new BadRequestException('Milestone must be approved before its funds can be released');
    }
    if (milestone.paymentAmount == null) {
      throw new BadRequestException('This milestone has no payment amount set');
    }

    const alreadyReleased = await this.prisma.payout.findFirst({
      where: { milestoneId, status: { not: 'failed' } },
    });
    if (alreadyReleased) {
      throw new ConflictException('This milestone has already been released');
    }

    const escrowAccount = await this.prisma.escrowAccount.findUnique({ where: { projectId } });
    if (!escrowAccount) {
      throw new BadRequestException('This project has no funded escrow account yet');
    }
    const amount = Number(milestone.paymentAmount);
    if (Number(escrowAccount.balance) < amount) {
      throw new BadRequestException('Insufficient escrow balance to release this milestone');
    }

    const assignment = await this.prisma.projectVendorAssignment.findFirst({ where: { projectId } });
    if (!assignment) {
      throw new BadRequestException('No vendor is assigned to this project yet — accept a quote first');
    }

    const newBalance = Number(escrowAccount.balance) - amount;
    const [, payout] = await this.prisma.$transaction([
      this.prisma.escrowAccount.update({ where: { id: escrowAccount.id }, data: { balance: newBalance } }),
      this.prisma.payout.create({
        data: {
          vendorId: assignment.vendorId,
          projectId,
          milestoneId,
          amount,
          currency: escrowAccount.currency,
          status: 'paid',
          paidAt: new Date(),
        },
      }),
      this.prisma.projectMilestone.update({ where: { id: milestoneId }, data: { status: 'completed' } }),
    ]);

    await this.prisma.escrowLedgerEntry.create({
      data: {
        escrowAccountId: escrowAccount.id,
        entryType: 'release',
        amount,
        balanceAfter: newBalance,
        relatedMilestoneId: milestoneId,
        relatedPayoutId: payout.id,
        notes: `Milestone released: ${milestone.title}`,
      },
    });
    const vendor = await this.prisma.vendor.findUnique({ where: { id: assignment.vendorId } });
    const receipt = await this.prisma.receipt.create({
      data: {
        accountId: vendor!.accountId,
        receiptNumber: receiptNumber(),
        payoutId: payout.id,
        amount,
        currency: escrowAccount.currency,
      },
    });

    return { payout, receipt };
  }

  findPayouts(projectId: string) {
    return this.prisma.payout.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
  }

  findReceipts(projectId: string) {
    return this.prisma.receipt.findMany({
      where: { OR: [{ payment: { projectId } }, { payout: { projectId } }] },
      orderBy: { issuedAt: 'desc' },
    });
  }

  raiseDispute(accountId: string, projectId: string, dto: RaiseDisputeDto) {
    return this.prisma.dispute.create({
      data: {
        projectId,
        raisedByAccountId: accountId,
        milestoneId: dto.milestoneId,
        paymentId: dto.paymentId,
        payoutId: dto.payoutId,
        reason: dto.reason,
      },
    });
  }

  findDisputes(projectId: string) {
    return this.prisma.dispute.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
  }

  // The account-wide rollup the sidebar's "Payments" item has been missing
  // since the Payments & escrow pass — every route above is deliberately
  // nested under one project (`:projectId` ABAC), so there was never a
  // "give me the money picture across everything I own" query. This one
  // isn't project-scoped, so it filters by accountId directly instead of
  // relying on PermissionsGuard's `:projectId` convention.
  //
  // Money is never summed across currencies — a project's escrow, and the
  // deposits/releases against it, keep their own currency, so totals are
  // grouped by currency rather than added into one misleading number (the
  // same caution generate_portfolio_report's README comment already flags
  // for cross-property currency).
  async getAccountOverview(accountId: string) {
    const projects = await this.prisma.project.findMany({
      where: { accountId },
      select: {
        id: true,
        title: true,
        status: true,
        currency: true,
        property: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const projectIds = projects.map((p: { id: string }) => p.id);

    if (projectIds.length === 0) {
      return {
        projectCount: 0,
        escrowByCurrency: [],
        depositedByCurrency: [],
        releasedByCurrency: [],
        openDisputeCount: 0,
        projects: [],
      };
    }

    const [escrowAccounts, depositTotals, releaseTotals, disputes] = await Promise.all([
      this.prisma.escrowAccount.findMany({ where: { projectId: { in: projectIds } } }),
      this.prisma.payment.groupBy({
        by: ['currency'],
        where: { projectId: { in: projectIds }, status: 'completed' },
        _sum: { amount: true },
      }),
      this.prisma.payout.groupBy({
        by: ['currency'],
        where: { projectId: { in: projectIds }, status: { not: 'failed' } },
        _sum: { amount: true },
      }),
      this.prisma.dispute.findMany({
        where: { projectId: { in: projectIds }, status: { in: ['open', 'under_review'] } },
        select: { id: true, projectId: true },
      }),
    ]);

    const escrowByCurrency = new Map<string, number>();
    for (const e of escrowAccounts as { currency: string; balance: unknown }[]) {
      escrowByCurrency.set(e.currency, (escrowByCurrency.get(e.currency) ?? 0) + Number(e.balance));
    }
    const escrowByProject = new Map(
      (escrowAccounts as { projectId: string; currency: string; balance: unknown; status: string }[]).map((e) => [
        e.projectId,
        e,
      ]),
    );
    const disputeCountByProject = new Map<string, number>();
    for (const d of disputes as { projectId: string }[]) {
      disputeCountByProject.set(d.projectId, (disputeCountByProject.get(d.projectId) ?? 0) + 1);
    }

    return {
      projectCount: projects.length,
      escrowByCurrency: Array.from(escrowByCurrency, ([currency, balance]) => ({ currency, balance })),
      depositedByCurrency: (depositTotals as { currency: string; _sum: { amount: unknown } }[]).map((d) => ({
        currency: d.currency,
        total: Number(d._sum.amount ?? 0),
      })),
      releasedByCurrency: (releaseTotals as { currency: string; _sum: { amount: unknown } }[]).map((r) => ({
        currency: r.currency,
        total: Number(r._sum.amount ?? 0),
      })),
      openDisputeCount: disputes.length,
      projects: projects.map((p: { id: string; title: string; status: string; currency: string; property: { name: string } }) => {
        const escrow = escrowByProject.get(p.id);
        return {
          projectId: p.id,
          title: p.title,
          propertyName: p.property?.name ?? null,
          status: p.status,
          currency: p.currency,
          escrowBalance: escrow ? Number(escrow.balance) : 0,
          escrowCurrency: escrow?.currency ?? p.currency,
          escrowStatus: escrow?.status ?? 'not_funded',
          openDisputeCount: disputeCountByProject.get(p.id) ?? 0,
        };
      }),
    };
  }

  async resolveDispute(projectId: string, disputeId: string, dto: ResolveDisputeDto) {
    const dispute = await this.prisma.dispute.findFirst({ where: { id: disputeId, projectId } });
    if (!dispute) throw new NotFoundException('Dispute not found on this project');
    return this.prisma.dispute.update({
      where: { id: disputeId },
      data: { status: dto.status, resolutionNotes: dto.resolutionNotes, resolvedAt: new Date() },
    });
  }
}
