import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DepositDto } from './dto/deposit.dto';
import { RaiseDisputeDto } from './dto/raise-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';

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

  // Refunds a completed deposit back out of escrow — the counterpart to
  // deposit() above, gated by "payment:approve" for the same reason
  // releaseMilestone is: it moves money out of escrow, so it deserves more
  // than the plain "payment:write" a deposit needs. Only refundable while
  // the deposit's own amount is still sitting in escrow — once enough of
  // it has been released to a vendor via milestones, there's nothing left
  // to give back and this fails with the same "insufficient balance" shape
  // releaseMilestone already uses, rather than allowing a refund that
  // would take the balance negative.
  async refundPayment(projectId: string, paymentId: string, dto: RefundPaymentDto) {
    const payment = await this.prisma.payment.findFirst({ where: { id: paymentId, projectId } });
    if (!payment) throw new NotFoundException('Payment not found on this project');
    if (payment.status !== 'completed') {
      throw new BadRequestException('Only a completed payment can be refunded');
    }

    const openDispute = await this.prisma.dispute.findFirst({
      where: { paymentId, status: { in: ['open', 'under_review'] } },
    });
    if (openDispute) {
      throw new BadRequestException('This payment has an open dispute — resolve it before refunding');
    }

    const escrowAccount = await this.prisma.escrowAccount.findUnique({ where: { id: payment.escrowAccountId } });
    if (!escrowAccount) {
      throw new BadRequestException('This payment has no escrow account to refund from');
    }
    const amount = Number(payment.amount);
    if (Number(escrowAccount.balance) < amount) {
      throw new BadRequestException(
        'Insufficient escrow balance to refund this payment — some of it has already been released',
      );
    }

    const newBalance = Number(escrowAccount.balance) - amount;
    const [, updatedPayment] = await this.prisma.$transaction([
      this.prisma.escrowAccount.update({ where: { id: escrowAccount.id }, data: { balance: newBalance } }),
      this.prisma.payment.update({ where: { id: paymentId }, data: { status: 'refunded' } }),
    ]);

    const ledgerEntry = await this.prisma.escrowLedgerEntry.create({
      data: {
        escrowAccountId: escrowAccount.id,
        entryType: 'refund',
        amount,
        balanceAfter: newBalance,
        relatedPaymentId: paymentId,
        notes: dto.reason ?? `Refund of deposit ${paymentId}`,
      },
    });

    return { payment: updatedPayment, ledgerEntry };
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

    const openDispute = await this.prisma.dispute.findFirst({
      where: { milestoneId, status: { in: ['open', 'under_review'] } },
    });
    if (openDispute) {
      throw new BadRequestException('This milestone has an open dispute — resolve it before releasing funds');
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

  // Closes half of the gap the README used to flag: "any account member
  // with dispute:write can both raise and resolve a dispute." There's
  // still no neutral third party in this scaffold's RBAC (same limitation
  // as document verification), but the account that raised a dispute can
  // no longer be the one that resolves it in its own favor — on a project,
  // the only other party able to act is whichever side (owner or vendor)
  // didn't raise it. That's a real check, not a full neutral-reviewer
  // workflow; still open, see the README.
  //
  // The check itself lives in this one private method so both sides of a
  // project share it: the owner-side route below (already ABAC-scoped to
  // its own project by PermissionsGuard) and VendorsService's vendor-side
  // route (which has no :projectId to lean on, so it checks a
  // ProjectVendorAssignment itself before ever reaching here).
  private async applyDisputeResolution(
    dispute: { id: string; raisedByAccountId: string; status: string },
    resolvingAccountId: string,
    dto: ResolveDisputeDto,
  ) {
    if (dispute.status === 'resolved' || dispute.status === 'rejected') {
      throw new ConflictException('This dispute has already been resolved');
    }
    if (dispute.raisedByAccountId === resolvingAccountId) {
      throw new ForbiddenException(
        'The account that raised this dispute cannot resolve it — the other party needs to weigh in',
      );
    }
    return this.prisma.dispute.update({
      where: { id: dispute.id },
      data: { status: dto.status, resolutionNotes: dto.resolutionNotes, resolvedAt: new Date() },
    });
  }

  async resolveDispute(projectId: string, disputeId: string, resolvingAccountId: string, dto: ResolveDisputeDto) {
    const dispute = await this.prisma.dispute.findFirst({ where: { id: disputeId, projectId } });
    if (!dispute) throw new NotFoundException('Dispute not found on this project');
    return this.applyDisputeResolution(dispute, resolvingAccountId, dto);
  }

  // The vendor-side counterpart to resolveDispute above — deliberately not
  // under /projects/:projectId/..., same reasoning as submitQuote, so it
  // looks the dispute up by id alone and checks a ProjectVendorAssignment
  // itself instead of relying on PermissionsGuard's ABAC. 404s (not 403)
  // for a dispute on a project this vendor isn't assigned to, so it can't
  // be used to probe which disputes exist on projects it has nothing to
  // do with.
  async resolveDisputeAsVendor(vendorAccountId: string, disputeId: string, dto: ResolveDisputeDto) {
    const vendor = await this.prisma.vendor.findUnique({ where: { accountId: vendorAccountId } });
    if (!vendor) throw new NotFoundException('Dispute not found');
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    const assignment = await this.prisma.projectVendorAssignment.findFirst({
      where: { projectId: dispute.projectId, vendorId: vendor.id },
    });
    if (!assignment) throw new NotFoundException('Dispute not found');
    return this.applyDisputeResolution(dispute, vendorAccountId, dto);
  }

  // Vendor-side raise/read, same shape as submitQuote/myQuotes: the vendor
  // is never assumed to be the project's owning account, so these key off
  // ProjectVendorAssignment instead of PermissionsGuard's :projectId ABAC.
  async raiseDisputeAsVendor(vendorAccountId: string, dto: RaiseDisputeDto & { projectId: string }) {
    const vendor = await this.prisma.vendor.findUnique({ where: { accountId: vendorAccountId } });
    if (!vendor) {
      throw new BadRequestException('This account has no vendor profile yet — create one with POST /vendors first');
    }
    const assignment = await this.prisma.projectVendorAssignment.findFirst({
      where: { projectId: dto.projectId, vendorId: vendor.id },
    });
    if (!assignment) {
      throw new BadRequestException('This vendor is not assigned to this project');
    }
    return this.prisma.dispute.create({
      data: {
        projectId: dto.projectId,
        raisedByAccountId: vendorAccountId,
        milestoneId: dto.milestoneId,
        paymentId: dto.paymentId,
        payoutId: dto.payoutId,
        reason: dto.reason,
      },
    });
  }

  async findDisputesForVendor(vendorAccountId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { accountId: vendorAccountId } });
    if (!vendor) return [];
    const assignments = await this.prisma.projectVendorAssignment.findMany({
      where: { vendorId: vendor.id },
      select: { projectId: true },
    });
    const projectIds = assignments.map((a: { projectId: string }) => a.projectId);
    if (projectIds.length === 0) return [];
    return this.prisma.dispute.findMany({
      where: { projectId: { in: projectIds } },
      include: { project: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
