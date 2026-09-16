import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
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
  TENANT: 'tenant',
};

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Security fix: addMember previously accepted any roleKey that happened to
// be seeded, including platform_admin/platform_reviewer — both of which
// this codebase's own seed.ts comments describe as meant to exist only via
// direct seed/DB access, never a self-service invite. PermissionsGuard's
// :accountId ABAC check only proves the target account is the caller's
// own; it says nothing about which role the caller is granting there, so
// nothing previously stopped any account:manage_members holder (e.g. any
// ordinary property_owner) from adding themselves as platform_admin on
// their own account and inheriting account:read_all/account:suspend
// platform-wide. Both this direct-member path and the pending-invite path
// below share this one check since both start from the same role lookup.
const PLATFORM_ONLY_ROLE_KEYS = new Set(['platform_admin', 'platform_reviewer']);

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
    // The one account type with a choice of role at creation time — see
    // CreateAccountDto.vendorRole's own comment. Every other accountType
    // always gets its one fixed default, dto.vendorRole is simply ignored
    // for them.
    const roleKey =
      dto.accountType === 'VENDOR' && dto.vendorRole === 'inspector'
        ? 'inspector'
        : DEFAULT_OWNER_ROLE_BY_ACCOUNT_TYPE[dto.accountType];
    const role = await this.prisma.role.findUnique({ where: { key: roleKey } });
    if (!role) {
      throw new BadRequestException(
        `Role "${roleKey}" is not seeded — run the seed script before creating a ${dto.accountType} account.`,
      );
    }

    const account = await this.prisma.account.create({
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

    // Closes the "landlord has to know a tenant signed up, and click
    // link themselves" gap PropertiesService.linkTenantAccount's own
    // comment used to flag: a brand-new TENANT account auto-links itself
    // to every still-unlinked lease whose tenantEmail matches this same
    // user, then emails whoever owns each of those properties. This
    // never replaces the manual "Link tenant account" action on
    // properties/[id].tsx — that stays for a lease created *after* the
    // tenant already has an account, or as a manual correction — it just
    // means the common "tenant signs up after the lease exists" case no
    // longer needs it.
    if (dto.accountType === 'TENANT') {
      await this.linkMatchingLeasesForNewTenant(account.id, userId);
    }

    return account;
  }

  // Every nav audit's own repeated finding, once per role: "Settings —
  // missing (no settings page anywhere)." Real, already-persisted
  // Account fields (name/currency/timezone) have never had any edit
  // path since creation — CreateAccountDto sets them once and nothing
  // since has ever let an account change its own. Deliberately no
  // permission check beyond "is a real member of this account" — unlike
  // account:manage_members (adding/removing OTHER people), editing an
  // account's own basic info isn't a privileged action over anyone
  // else, and gating it on account:manage_members would lock every
  // solo VENDOR/SUPPLIER/TENANT account — accounts that are their own
  // only member — out of Settings entirely, the same gap this closure
  // is meant to fix for those roles too.
  getSelf(accountId: string) {
    return this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      select: { id: true, accountType: true, name: true, country: true, currency: true, timezone: true, reportDigestFrequency: true },
    });
  }

  updateSelf(accountId: string, dto: UpdateAccountDto) {
    return this.prisma.account.update({
      where: { id: accountId },
      data: { name: dto.name, currency: dto.currency, timezone: dto.timezone },
      select: { id: true, accountType: true, name: true, country: true, currency: true, timezone: true, reportDigestFrequency: true },
    });
  }

  private async linkMatchingLeasesForNewTenant(tenantAccountId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    const matchingLeases = await this.prisma.lease.findMany({
      where: { tenantEmail: user.email, tenantAccountId: null },
      include: { property: { select: { name: true, accountId: true } } },
    });

    for (const lease of matchingLeases) {
      await this.prisma.lease.update({ where: { id: lease.id }, data: { tenantAccountId } });

      const landlordMembers = await this.prisma.accountMember.findMany({
        where: { accountId: lease.property.accountId },
        include: { user: { select: { email: true } } },
      });
      for (const member of landlordMembers) {
        const sent = await this.email.send({
          to: member.user.email,
          subject: `${lease.tenantName} has linked their tenant account`,
          html: `<p><strong>${lease.tenantName}</strong> (${user.email}) just created a PropertyOnTheGo tenant account and it's now linked to their lease at <strong>${lease.property.name}</strong>.</p><p>They can now see their lease, rent history, and report maintenance issues from their own account.</p>`,
          text: `${lease.tenantName} (${user.email}) just created a PropertyOnTheGo tenant account and it's now linked to their lease at ${lease.property.name}. They can now see their lease, rent history, and report maintenance issues from their own account.`,
        });
        this.logger.log(
          `Auto-linked tenant account ${tenantAccountId} to lease ${lease.id} — notified ${member.user.email} ${this.describeSendStatus(sent)}`,
        );
      }
    }
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
    if (PLATFORM_ONLY_ROLE_KEYS.has(role.key)) {
      throw new ForbiddenException(`"${role.key}" can't be granted through account membership — it's platform-wide, not account-scoped`);
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

  // Shared by acceptInvite (token path) and acceptMyInvite (session path)
  // below — the actual membership-grant + invite-consume transaction,
  // once each path's own way of proving "this invite is really for me"
  // has already passed.
  private async applyAcceptInvite(invite: { id: string; accountId: string; roleId: string }, userId: string) {
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
    return this.applyAcceptInvite(invite, userId);
  }

  // Closes the "no invite listing beyond the account's own Members page"
  // gap — until now the *only* place any invite was visible was the
  // inviting account's own Members page; a recipient with no access to
  // that page (or who lost the email) had no way to discover they'd been
  // invited at all. Lists every still-pending, unexpired invite sent to
  // this signed-in user's own email, across every account.
  findMyInvites(email: string) {
    return this.prisma.accountInvite.findMany({
      where: { email, status: 'pending', expiresAt: { gt: new Date() } },
      include: {
        account: { select: { id: true, name: true, accountType: true } },
        role: { select: { key: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // The accept action for the list above — deliberately keyed by the
  // invite's own id rather than its bearer token: a signed-in user's
  // session already proves their email, so there's nothing a token would
  // add here that findMyInvites' own email filter doesn't already give.
  // 404s (not 403) on an email mismatch — this scaffold's usual "don't
  // confirm a cross-tenant resource exists" shape, same reasoning as
  // every other id-addressed lookup that isn't the caller's own.
  async acceptMyInvite(inviteId: string, userId: string, userEmail: string) {
    const invite = await this.prisma.accountInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.status !== 'pending' || invite.expiresAt < new Date()) {
      throw new BadRequestException('This invite is invalid or has expired');
    }
    if (invite.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new NotFoundException('Invite not found');
    }
    return this.applyAcceptInvite(invite, userId);
  }
}
