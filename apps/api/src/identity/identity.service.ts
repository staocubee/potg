import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DojahService } from './dojah.service';
import { VerifyNinDto } from './dto/verify-nin.dto';

function normalizeTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

// Exact-token match only — "Chidinma" won't match a NIN record's
// "Chidimma" (a single typo/transliteration difference). Same
// simplification this scaffold's other "confirm it's really them" checks
// already make elsewhere (VendorsService.setBankDetails trusts Paystack's
// own resolved account name outright, no fuzzy compare either). A real
// deployment doing this for real would want a tolerant/fuzzy name match
// here, not an exact one.
function namesMatch(accountName: string, ninFirstName: string, ninLastName: string): boolean {
  const accountTokens = new Set(normalizeTokens(accountName));
  const [first] = normalizeTokens(ninFirstName);
  const [last] = normalizeTokens(ninLastName);
  return !!first && !!last && accountTokens.has(first) && accountTokens.has(last);
}

// Module 6's real identity-verification gap — see the schema comment on
// User.identityVerificationStatus for how this differs from
// Vendor/Supplier.verificationStatus (fully automated here, no human
// platform_reviewer decision).
@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dojah: DojahService,
  ) {}

  getStatus(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        identityVerificationStatus: true,
        identityVerificationNotes: true,
        identityVerifiedAt: true,
        ninLast4: true,
      },
    });
  }

  async verifyNin(userId: string, dto: VerifyNinDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.identityVerificationStatus === 'verified') {
      throw new ConflictException('This account is already identity-verified');
    }

    let record;
    try {
      record = await this.dojah.lookupNin(dto.nin);
    } catch (err) {
      // A failed lookup (no record, invalid NIN, provider error) is still
      // a real, terminal-for-now result worth recording — same "record
      // what actually happened" reasoning every other verification status
      // in this schema follows. ninLast4 is still set so a retry attempt
      // is visibly a retry, not a first try.
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          identityVerificationStatus: 'failed',
          identityVerificationNotes: err instanceof Error ? err.message : 'NIN lookup failed',
          ninLast4: dto.nin.slice(-4),
        },
      });
      throw err;
    }

    const matched = namesMatch(user.name, record.firstName, record.lastName);
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        identityVerificationStatus: matched ? 'verified' : 'failed',
        identityVerificationNotes: matched
          ? null
          : `The NIN record's name (${record.firstName} ${record.lastName}) doesn't match this account's name (${user.name})`,
        identityVerifiedAt: matched ? new Date() : null,
        ninLast4: dto.nin.slice(-4),
      },
      select: {
        identityVerificationStatus: true,
        identityVerificationNotes: true,
        identityVerifiedAt: true,
        ninLast4: true,
      },
    });
  }
}
