import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { EmailService } from '../notifications/email.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  // Shared by addMember/resendInvite's own log lines — distinguishes "no
  // RESEND_API_KEY at all" from "a key is set but this particular send
  // failed" (rate limit, a sandbox-mode restriction, a bad address, ...)
  // rather than blaming "no provider configured" for a failure that has
  // nothing to do with configuration. EmailService.send already logs the
  // specific reason itself when a configured send fails.
  private describeSendStatus(sent: boolean): string {
    if (sent) return '(emailed)';
    return this.email.isConfigured
      ? '(email send failed — see the EmailService error above)'
      : '(would be emailed, no RESEND_API_KEY configured)';
  }

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
    const account = await this.prisma.account.findUnique({ where: { id: accountId }, select: { name: true } });
    const sent = await this.email.send({
      to: dto.email,
      subject: `You've been invited to join ${account?.name ?? 'a PropertyOnTheGo account'}`,
      html: `<p>You've been invited to join <strong>${account?.name ?? 'a PropertyOnTheGo account'}</strong> on PropertyOnTheGo.</p><p><a href="${inviteLink}">Accept the invite</a></p><p>This link expires in 7 days.</p>`,
      text: `You've been invited to join ${account?.name ?? 'a PropertyOnTheGo account'} on PropertyOnTheGo: ${inviteLink}\n\nThis link expires in 7 days.`,
    });
    this.logger.log(`Invited ${dto.email} to account ${accountId} — link ${this.describeSendStatus(sent)}: ${inviteLink}`);

    // Same EmailService fallback shape as AuthService.forgotPassword — the
    // raw token is only ever in the response when nothing actually sent
    // it, same "no other channel for a developer/demo user to get it"
    // reasoning, and dropped the moment a real send succeeds.
    return { type: 'invite' as const, invite, inviteToken: sent ? undefined : rawToken };
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

  // Closes the "no way to revoke or resend" gap the README flagged: a
  // re-invite by email already worked as an implicit revoke+resend, but
  // there was no way to kill a pending invite without knowing its role
  // and re-submitting the whole form, and no way to kill one at all
  // without replacing it.
  private async requirePendingInvite(accountId: string, inviteId: string) {
    const invite = await this.prisma.accountInvite.findFirst({ where: { id: inviteId, accountId } });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.status !== 'pending') {
      throw new BadRequestException(`This invite is already "${invite.status}", not pending`);
    }
    return invite;
  }

  async revokeInvite(accountId: string, inviteId: string) {
    await this.requirePendingInvite(accountId, inviteId);
    return this.prisma.accountInvite.update({ where: { id: inviteId }, data: { status: 'revoked' } });
  }

  // Same token-rotation as the implicit resend inside addMember (a new raw
  // token, a new tokenHash, a refreshed expiry) but keyed off the invite
  // itself rather than the invited email — the caller doesn't have to know
  // or re-pick a role. Same "no email provider" tradeoff: the raw token
  // is logged and returned rather than actually emailed.
  async resendInvite(accountId: string, inviteId: string, invitedByUserId: string) {
    const existing = await this.requirePendingInvite(accountId, inviteId);
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invite = await this.prisma.accountInvite.update({
      where: { id: inviteId },
      data: { tokenHash, expiresAt, invitedByUserId },
    });

    const inviteLink = `${process.env.WEB_APP_URL ?? 'http://localhost:3000'}/accept-invite?token=${rawToken}`;
    const account = await this.prisma.account.findUnique({ where: { id: accountId }, select: { name: true } });
    const sent = await this.email.send({
      to: existing.email,
      subject: `You've been invited to join ${account?.name ?? 'a PropertyOnTheGo account'}`,
      html: `<p>You've been invited to join <strong>${account?.name ?? 'a PropertyOnTheGo account'}</strong> on PropertyOnTheGo.</p><p><a href="${inviteLink}">Accept the invite</a></p><p>This link expires in 7 days.</p>`,
      text: `You've been invited to join ${account?.name ?? 'a PropertyOnTheGo account'} on PropertyOnTheGo: ${inviteLink}\n\nThis link expires in 7 days.`,
    });
    this.logger.log(`Resent invite for ${existing.email} on account ${accountId} — link ${this.describeSendStatus(sent)}: ${inviteLink}`);

    return { invite, inviteToken: sent ? undefined : rawToken };
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
