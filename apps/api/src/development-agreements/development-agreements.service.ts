import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';
import { CreateDevelopmentAgreementDto } from './dto/create-development-agreement.dto';

const AGREEMENT_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days — longer than AccountInvite's 7, since a real build deal takes longer to consider than joining an account

@Injectable()
export class DevelopmentAgreementsService {
  private readonly logger = new Logger(DevelopmentAgreementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  private describeSendStatus(sent: boolean): string {
    return sent
      ? '(emailed)'
      : this.email.isConfigured
        ? '(email send failed — see the EmailService error above)'
        : '(would be emailed, no RESEND_API_KEY configured)';
  }

  // Same cross-field shape check reasoning CreateDevelopmentAgreementDto's
  // own comment gives for leaving this out of the DTO — which fields are
  // required depends on agreementType.
  private validateTerms(dto: CreateDevelopmentAgreementDto) {
    if (dto.agreementType === 'temporary_ownership') {
      if (dto.ownershipPercentage == null || dto.termMonths == null) {
        throw new BadRequestException('temporary_ownership agreements need both ownershipPercentage and termMonths');
      }
    } else if (dto.agreementType === 'proceeds_share') {
      if (dto.proceedsSharePercentage == null) {
        throw new BadRequestException('proceeds_share agreements need proceedsSharePercentage');
      }
    }
  }

  async propose(propertyId: string, accountId: string, proposedByUserId: string, dto: CreateDevelopmentAgreementDto) {
    this.validateTerms(dto);
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, accountId } });
    if (!property) throw new NotFoundException('Property not found');

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + AGREEMENT_TTL_MS);

    const agreement = await this.prisma.propertyDevelopmentAgreement.create({
      data: {
        propertyId,
        accountId,
        proposedByUserId,
        developerEmail: dto.developerEmail,
        agreementType: dto.agreementType,
        ownershipPercentage: dto.ownershipPercentage,
        termMonths: dto.termMonths,
        proceedsSharePercentage: dto.proceedsSharePercentage,
        terms: dto.terms,
        tokenHash,
        expiresAt,
      },
    });

    const dealSummary =
      dto.agreementType === 'temporary_ownership'
        ? `a ${dto.ownershipPercentage}% ownership stake for ${dto.termMonths} month(s)`
        : `a ${dto.proceedsSharePercentage}% share of the property's eventual sale proceeds`;
    const link = `${process.env.WEB_APP_URL ?? 'http://localhost:3000'}/accept-development-agreement?token=${rawToken}`;
    const sent = await this.email.send({
      to: dto.developerEmail,
      subject: `You've been invited to develop "${property.name}" on PropertyOnTheGo`,
      html: `<p><strong>${property.name}</strong>'s owner has invited you to build on this property, proposing ${dealSummary}.</p><p>${dto.terms.replace(/</g, '&lt;')}</p><p><a href="${link}">Review and respond</a></p><p>This invite expires in 14 days.</p>`,
      text: `${property.name}'s owner has invited you to build on this property, proposing ${dealSummary}.\n\n${dto.terms}\n\nReview and respond: ${link}\n\nThis invite expires in 14 days.`,
    });
    this.logger.log(`Invited ${dto.developerEmail} to develop property ${propertyId} — link ${this.describeSendStatus(sent)}: ${link}`);

    return { agreement, inviteToken: sent ? undefined : rawToken };
  }

  findForProperty(propertyId: string) {
    return this.prisma.propertyDevelopmentAgreement.findMany({
      where: { propertyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cancel(propertyId: string, agreementId: string) {
    const agreement = await this.prisma.propertyDevelopmentAgreement.findUnique({ where: { id: agreementId } });
    if (!agreement || agreement.propertyId !== propertyId) {
      throw new NotFoundException('Development agreement not found');
    }
    if (agreement.status !== 'pending') {
      throw new BadRequestException(`This agreement is already "${agreement.status}", not pending`);
    }
    return this.prisma.propertyDevelopmentAgreement.update({ where: { id: agreementId }, data: { status: 'cancelled' } });
  }

  // Public preview by raw token — same "let a possibly-not-yet-registered
  // recipient see what they're being invited into before choosing to log
  // in or register" reasoning AccountsService.getInvite already uses.
  async getByToken(rawToken: string) {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const agreement = await this.prisma.propertyDevelopmentAgreement.findUnique({
      where: { tokenHash },
      include: { property: { select: { name: true, addressLine: true, city: true } } },
    });
    if (!agreement || agreement.status !== 'pending' || agreement.expiresAt < new Date()) {
      throw new NotFoundException('This invite is invalid or has expired');
    }
    const existingUser = await this.prisma.user.findUnique({ where: { email: agreement.developerEmail } });
    return {
      propertyName: agreement.property.name,
      propertyAddress: [agreement.property.addressLine, agreement.property.city].filter(Boolean).join(', '),
      developerEmail: agreement.developerEmail,
      agreementType: agreement.agreementType,
      ownershipPercentage: agreement.ownershipPercentage,
      termMonths: agreement.termMonths,
      proceedsSharePercentage: agreement.proceedsSharePercentage,
      terms: agreement.terms,
      expiresAt: agreement.expiresAt,
      hasAccount: !!existingUser,
    };
  }

  private async requirePendingByToken(rawToken: string, userEmail: string) {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const agreement = await this.prisma.propertyDevelopmentAgreement.findUnique({ where: { tokenHash } });
    if (!agreement || agreement.status !== 'pending' || agreement.expiresAt < new Date()) {
      throw new BadRequestException('This invite is invalid or has expired');
    }
    if (agreement.developerEmail.toLowerCase() !== userEmail.toLowerCase()) {
      throw new ForbiddenException('This invite was sent to a different email address');
    }
    return agreement;
  }

  // Accepting requires the caller to already be acting as an account
  // (CurrentAccountMember, not just CurrentUser) — that account is what
  // actually holds the stake (temporary_ownership) or the future claim
  // (proceeds_share), the same way PropertyAccessGrant needs a real
  // accountMemberId, not just a user.
  async acceptByToken(rawToken: string, userEmail: string, developerAccountId: string) {
    const agreement = await this.requirePendingByToken(rawToken, userEmail);
    return this.applyAccept(agreement, developerAccountId);
  }

  async declineByToken(rawToken: string, userEmail: string) {
    const agreement = await this.requirePendingByToken(rawToken, userEmail);
    return this.prisma.propertyDevelopmentAgreement.update({
      where: { id: agreement.id },
      data: { status: 'declined', respondedAt: new Date() },
    });
  }

  // The "mine" inbox — same gap AccountsService.findMyInvites closed for
  // account invites: without this, a developer whose invite email never
  // arrived (no RESEND_API_KEY configured, the common case in this
  // scaffold) has no way to discover or act on an invite at all except a
  // link the owner manually copies out for them.
  findMine(email: string) {
    return this.prisma.propertyDevelopmentAgreement.findMany({
      where: { developerEmail: email, status: 'pending', expiresAt: { gt: new Date() } },
      include: { property: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async acceptMine(agreementId: string, userEmail: string, developerAccountId: string) {
    const agreement = await this.prisma.propertyDevelopmentAgreement.findUnique({ where: { id: agreementId } });
    if (!agreement || agreement.status !== 'pending' || agreement.expiresAt < new Date()) {
      throw new BadRequestException('This invite is invalid or has expired');
    }
    if (agreement.developerEmail.toLowerCase() !== userEmail.toLowerCase()) {
      throw new NotFoundException('Development agreement invite not found');
    }
    return this.applyAccept(agreement, developerAccountId);
  }

  async declineMine(agreementId: string, userEmail: string) {
    const agreement = await this.prisma.propertyDevelopmentAgreement.findUnique({ where: { id: agreementId } });
    if (!agreement || agreement.status !== 'pending' || agreement.expiresAt < new Date()) {
      throw new BadRequestException('This invite is invalid or has expired');
    }
    if (agreement.developerEmail.toLowerCase() !== userEmail.toLowerCase()) {
      throw new NotFoundException('Development agreement invite not found');
    }
    return this.prisma.propertyDevelopmentAgreement.update({
      where: { id: agreement.id },
      data: { status: 'declined', respondedAt: new Date() },
    });
  }

  // The actual accept transaction: mark the agreement accepted, and for
  // temporary_ownership only, write a real PropertyOwner row — see this
  // model's own schema comment for why proceeds_share deliberately writes
  // no such row (there's nothing yet for a future sale-proceeds claim to
  // attach to).
  private async applyAccept(
    agreement: {
      id: string;
      propertyId: string;
      agreementType: string;
      ownershipPercentage: unknown;
      termMonths: number | null;
    },
    developerAccountId: string,
  ) {
    const now = new Date();
    const [updated] = await this.prisma.$transaction([
      this.prisma.propertyDevelopmentAgreement.update({
        where: { id: agreement.id },
        data: { status: 'accepted', respondedAt: now, developerAccountId },
      }),
      ...(agreement.agreementType === 'temporary_ownership'
        ? [
            this.prisma.propertyOwner.create({
              data: {
                propertyId: agreement.propertyId,
                ownerType: 'account',
                ownerAccountId: developerAccountId,
                ownershipPercentage: agreement.ownershipPercentage as any,
                startDate: now,
                endDate: new Date(now.getFullYear(), now.getMonth() + (agreement.termMonths ?? 0), now.getDate()),
              },
            }),
          ]
        : []),
    ]);
    return updated;
  }
}
