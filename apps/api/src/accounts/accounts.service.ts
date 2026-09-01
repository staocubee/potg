import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { AddMemberDto } from './dto/add-member.dto';

// The role a user creating a new account is granted automatically —
// mirrors Section 8's core roles. Seed data (prisma/seed.ts) must define a
// Role with each of these keys.
const DEFAULT_OWNER_ROLE_BY_ACCOUNT_TYPE: Record<string, string> = {
  INDIVIDUAL: 'property_owner',
  FAMILY: 'family_admin',
  COMPANY: 'company_admin',
  VENDOR: 'vendor',
  SUPPLIER: 'supplier',
};

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateAccountDto) {
    const roleKey = DEFAULT_OWNER_ROLE_BY_ACCOUNT_TYPE[dto.accountType];
    const role = await this.prisma.role.findUnique({ where: { key: roleKey } });
    if (!role) {
      throw new BadRequestException(
        `Role "${roleKey}" is not seeded — run the seed script before creating a ${dto.accountType} account.`,
      );
    }

    return this.prisma.account.create({
      data: {
        accountType: dto.accountType as any,
        name: dto.name,
        country: dto.country,
        currency: dto.currency,
        timezone: dto.timezone,
        members: {
          create: { userId, roleId: role.id },
        },
      },
      include: { members: true },
    });
  }

  // If `dto.email` already has a User, this behaves exactly as it always
  // did: adds/updates their membership immediately. If it doesn't, it now
  // creates (or refreshes) a pending AccountInvite instead of failing
  // outright — the gap AddMemberDto's own comment used to flag. Either
  // outcome is tagged so the caller can tell which one happened.
  async addMember(accountId: string, invitedByUserId: string, dto: AddMemberDto) {
    const role = await this.prisma.role.findUnique({ where: { key: dto.roleKey } });
    if (!role) {
      throw new BadRequestException(`Unknown role key "${dto.roleKey}"`);
    }

    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (user) {
      const member = await this.prisma.accountMember.upsert({
        where: { accountId_userId: { accountId, userId: user.id } },
        update: { roleId: role.id, status: 'active' },
        create: { accountId, userId: user.id, roleId: role.id },
      });
      return { type: 'member' as const, member };
    }

    const existingInvite = await this.prisma.accountInvite.findFirst({
      where: { accountId, email: dto.email, status: 'pending' },
    });
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invite = existingInvite
      ? await this.prisma.accountInvite.update({
          where: { id: existingInvite.id },
          data: { roleId: role.id, tokenHash, expiresAt, invitedByUserId },
        })
      : await this.prisma.accountInvite.create({
          data: { accountId, email: dto.email, roleId: role.id, tokenHash, expiresAt, invitedByUserId },
        });

    const inviteLink = `${process.env.WEB_APP_URL ?? 'http://localhost:3000'}/accept-invite?token=${rawToken}`;
    this.logger.log(`Invited ${dto.email} to account ${accountId} — link (would be emailed): ${inviteLink}`);

    // Same "no email provider" tradeoff as AuthService.forgotPassword —
    // logged server-side and ONLY returned raw here because there's no
    // other channel for a developer/demo user to get it. A real
    // deployment must drop `inviteToken` from the response.
    return { type: 'invite' as const, invite, inviteToken: rawToken };
  }

  // Public-facing (see InvitesController — no account context, possibly no
  // auth at all yet) preview of what an invite link leads to, so the
  // recipient can decide whether to log in or register before spending an
  // API call on either.
  async getInvite(rawToken: string) {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const invite = await this.prisma.accountInvite.findUnique({
      where: { tokenHash },
      include: { account: { select: { name: true, accountType: true } }, role: { select: { key: true, name: true } } },
    });
    if (!invite || invite.status !== 'pending' || invite.expiresAt < new Date()) {
      throw new NotFoundException('This invite is invalid or has expired');
    }
    const existingUser = await this.prisma.user.findUnique({ where: { email: invite.email } });
    return {
      accountName: invite.account.name,
      accountType: invite.account.accountType,
      roleName: invite.role.name,
      email: invite.email,
      expiresAt: invite.expiresAt,
      hasAccount: !!existingUser,
    };
  }

  // Everything account:manage_members needs to see on one screen: current
  // members (with the user's name/email so the page doesn't need a
  // separate lookup) and outstanding invites (so a re-invite or a still-
  // pending one isn't invisible). Never existed before this pass — there
  // was no way to see who was already in an account at all, only to add
  // someone.
  async listMembers(accountId: string) {
    const [members, invites] = await Promise.all([
      this.prisma.accountMember.findMany({
        where: { accountId },
        include: { user: { select: { id: true, name: true, email: true } }, role: { select: { key: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.accountInvite.findMany({
        where: { accountId, status: 'pending' },
        include: { role: { select: { key: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { members, invites };
  }

  // Called by InvitesController for an already-registered, already-
  // signed-in user. AuthService.register has its own copy of this same
  // validate-then-consume logic for someone accepting an invite by
  // registering fresh — see its comment for why that's not just a call
  // into this method.
  async acceptInvite(rawToken: string, userId: string, userEmail: string) {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const invite = await this.prisma.accountInvite.findUnique({ where: { tokenHash } });
    if (!invite || invite.status !== 'pending' || invite.expiresAt < new Date()) {
      throw new BadRequestException('This invite is invalid or has expired');
    }
    if (invite.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new ForbiddenException('This invite was sent to a different email address');
    }

    const [member] = await this.prisma.$transaction([
      this.prisma.accountMember.upsert({
        where: { accountId_userId: { accountId: invite.accountId, userId } },
        update: { roleId: invite.roleId, status: 'active' },
        create: { accountId: invite.accountId, userId, roleId: invite.roleId },
      }),
      this.prisma.accountInvite.update({ where: { id: invite.id }, data: { status: 'accepted', acceptedAt: new Date() } }),
    ]);
    return member;
  }
}
