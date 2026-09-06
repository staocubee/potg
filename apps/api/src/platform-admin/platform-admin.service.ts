import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Module 16-24's "admin operations" bucket, scoped to its one genuinely
// buildable slice — see PlatformAdminAction's own schema comment for why
// this is a distinct job from ComplianceService/platform_reviewer's own
// work, not a rename of either. Every method here is genuinely
// platform-wide, like ComplianceService already is: no accountId scoping
// anywhere, gated purely by account:read_all/account:suspend (which only
// platform_admin carries — see seed.ts).
@Injectable()
export class PlatformAdminService {
  constructor(private readonly prisma: PrismaService) {}

  // The directory itself — nothing on this platform could previously see
  // every account that exists in one place. Health signals kept
  // deliberately minimal and honestly computable for every AccountType
  // (INDIVIDUAL/FAMILY/COMPANY/VENDOR/SUPPLIER/TENANT alike) — no
  // "last activity" signal, since nothing on Account itself tracks that
  // (updatedAt only moves when the account row itself changes, not on
  // general use, so surfacing it as "last activity" would be misleading).
  async listAccounts() {
    const accounts = await this.prisma.account.findMany({
      select: {
        id: true,
        name: true,
        accountType: true,
        status: true,
        createdAt: true,
        _count: { select: { members: true } },
      },
    });

    return accounts
      .map((a) => ({
        id: a.id,
        name: a.name,
        accountType: a.accountType,
        status: a.status,
        memberCount: a._count.members,
        createdAt: a.createdAt,
      }))
      .sort((a, b) => {
        if (a.status === 'suspended' && b.status !== 'suspended') return -1;
        if (a.status !== 'suspended' && b.status === 'suspended') return 1;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
  }

  private async requireAccount(accountId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  // The actual lever the directory exists to point at. Blocks suspending
  // the caller's own acting account — a cheap, real safeguard against a
  // platform_admin accidentally locking itself out (AccountContextGuard
  // would then refuse every request acting as that account, this one
  // included, with no path back in short of a direct database fix).
  async suspendAccount(targetAccountId: string, reason: string, actorAccountId: string, actorUserId: string) {
    if (targetAccountId === actorAccountId) {
      throw new BadRequestException('You cannot suspend the account you are currently acting as');
    }
    const account = await this.requireAccount(targetAccountId);
    if (account.status === 'suspended') {
      throw new BadRequestException('This account is already suspended');
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.account.update({ where: { id: targetAccountId }, data: { status: 'suspended' } }),
      this.prisma.platformAdminAction.create({
        data: { targetAccountId, action: 'suspend', reason, performedByUserId: actorUserId },
      }),
    ]);
    return updated;
  }

  async reinstateAccount(targetAccountId: string, reason: string, actorUserId: string) {
    const account = await this.requireAccount(targetAccountId);
    if (account.status !== 'suspended') {
      throw new BadRequestException('This account is not currently suspended');
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.account.update({ where: { id: targetAccountId }, data: { status: 'active' } }),
      this.prisma.platformAdminAction.create({
        data: { targetAccountId, action: 'reinstate', reason, performedByUserId: actorUserId },
      }),
    ]);
    return updated;
  }

  // The audit-log half — every suspend/reinstate action, most recent
  // first, with the target account's own current name resolved so this
  // reads as a real log rather than a table of raw ids. Capped at 200:
  // this is an operational log to scroll through, not something a query
  // parameter needs to page through yet.
  async getAuditLog() {
    const actions = await this.prisma.platformAdminAction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { targetAccount: { select: { name: true } } },
    });
    return actions.map((a) => ({
      id: a.id,
      targetAccountId: a.targetAccountId,
      targetAccountName: a.targetAccount.name,
      action: a.action,
      reason: a.reason,
      performedByUserId: a.performedByUserId,
      createdAt: a.createdAt,
    }));
  }
}
