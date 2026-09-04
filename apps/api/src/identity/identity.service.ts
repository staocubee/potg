import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SumsubService } from './sumsub.service';

// Module 6's real identity-verification gap — see the schema comment on
// User.identityVerificationStatus for how this differs from
// Vendor/Supplier.verificationStatus (fully automated here, no human
// platform_reviewer decision — Sumsub's own reviewers are the human
// step). Two actions rather than Dojah's one, because a document/selfie
// review is inherently asynchronous: startVerification kicks it off,
// refreshStatus polls for a result once the user's actually gone
// through Sumsub's WebSDK.
@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sumsub: SumsubService,
  ) {}

  getStatus(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        identityVerificationStatus: true,
        identityVerificationNotes: true,
        identityVerifiedAt: true,
        sumsubApplicantId: true,
      },
    });
  }

  // Creates the Sumsub applicant on first call (reused on every later
  // call — an applicant is a standing record on Sumsub's side, not
  // something to recreate per attempt) and mints a fresh WebSDK access
  // token every time, since those are short-lived by design. The
  // frontend takes this token straight to Sumsub's own WebSDK — no
  // document or selfie image ever passes through this backend.
  async startVerification(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.identityVerificationStatus === 'verified') {
      throw new ConflictException('This account is already identity-verified');
    }

    let applicantId = user.sumsubApplicantId;
    if (!applicantId) {
      const created = await this.sumsub.createApplicant(userId);
      applicantId = created.applicantId;
      await this.prisma.user.update({ where: { id: userId }, data: { sumsubApplicantId: applicantId } });
    }
    const { token } = await this.sumsub.getAccessToken(userId);
    return { applicantId, accessToken: token };
  }

  // Pull-based, not webhook-driven — see SumsubService's own comment on
  // why. Safe to call repeatedly (a user checking back after finishing
  // the WebSDK flow, or just impatient) — always re-reads Sumsub's
  // current answer rather than trusting a locally cached one.
  async refreshStatus(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.sumsubApplicantId) {
      throw new BadRequestException('Verification has not been started yet — call POST /identity/start first');
    }

    const result = await this.sumsub.getApplicantStatus(user.sumsubApplicantId);
    let status = 'pending';
    let notes: string | null = null;
    let verifiedAt: Date | null = null;
    if (result.reviewStatus === 'completed') {
      if (result.reviewAnswer === 'GREEN') {
        status = 'verified';
        verifiedAt = new Date();
      } else {
        status = 'failed';
        notes = result.rejectLabels && result.rejectLabels.length > 0
          ? `Sumsub rejected this verification: ${result.rejectLabels.join(', ')}`
          : 'Sumsub rejected this verification';
      }
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { identityVerificationStatus: status, identityVerificationNotes: notes, identityVerifiedAt: verifiedAt },
      select: {
        identityVerificationStatus: true,
        identityVerificationNotes: true,
        identityVerifiedAt: true,
        sumsubApplicantId: true,
      },
    });
  }
}
