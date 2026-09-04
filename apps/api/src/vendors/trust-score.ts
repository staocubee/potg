import { PrismaService } from '../prisma/prisma.service';

export type VendorTrustAuditFactor = { rating: string; notes: string; createdAt: Date } | null;

export type VendorTrustFactors = {
  verificationStatus: string;
  ratingAverage: number | null;
  reviewCount: number;
  completedProjects: number;
  disputeCount: number;
  // The two signals that make this an actual (partial) independent
  // audit rather than only recomputed platform activity — see
  // VendorTrustAudit's own schema comment and User.identityVerificationStatus's.
  latestAudit: VendorTrustAuditFactor;
  identityVerifiedOperator: boolean;
};

export type VendorTrustScore = {
  score: number;
  band: 'excellent' | 'good' | 'fair' | 'caution';
  factors: VendorTrustFactors;
};

// Module 6's "trust score" — no longer *only* the platform's own
// recomputed activity data (verification status, review ratings,
// completed project count, disputes). Two real external-ish signals now
// feed it too: a platform_reviewer's own filed VendorTrustAudit (a real
// human actually looked into this vendor and recorded a judgment,
// distinct from the reviews its own customers left), and whether the
// account behind this vendor profile has passed real NIN identity
// verification (IdentityService, Module 6's KYC pass) — a
// government-backed signal, not platform-generated at all. Reviews
// still come from the accounts that hired the vendor, and
// verificationStatus is still a gate a human sets, not an audit itself —
// this is a real step closer to "independent audit," not the full thing.
// Shared between VendorsService (attached to GET /vendors/:id and
// .../me) and the explain_vendor_trust_score AI skill so both read the
// exact same formula.
export function computeVendorTrustScore(factors: VendorTrustFactors): VendorTrustScore {
  let score = 50;
  if (factors.verificationStatus === 'verified') score += 20;
  else if (factors.verificationStatus === 'pending') score += 5;

  if (factors.ratingAverage != null) score += (factors.ratingAverage - 3) * 10;

  score += Math.min(factors.completedProjects * 3, 15);
  score -= Math.min(factors.disputeCount * 8, 30);

  // The most authoritative signal available gets the widest swing —
  // wider than reviews or dispute count alone can move it, since a
  // real audit is exactly what those two are a proxy for in the first
  // place.
  if (factors.latestAudit?.rating === 'clean') score += 15;
  else if (factors.latestAudit?.rating === 'minor_concerns') score -= 10;
  else if (factors.latestAudit?.rating === 'major_concerns') score -= 35;

  if (factors.identityVerifiedOperator) score += 10;

  score = Math.max(0, Math.min(100, Math.round(score)));

  const band = score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'fair' : 'caution';
  return { score, band, factors };
}

export async function getVendorTrustScore(
  prisma: PrismaService,
  vendor: { id: string; accountId: string; verificationStatus: string; ratingAverage: unknown },
): Promise<VendorTrustScore> {
  const [reviewCount, completedProjects, disputeCount, latestAudit, verifiedOperatorCount] = await Promise.all([
    prisma.vendorReview.count({ where: { vendorId: vendor.id, moderationStatus: { not: 'hidden' } } }),
    prisma.projectVendorAssignment.count({ where: { vendorId: vendor.id, project: { status: 'completed' } } }),
    prisma.dispute.count({ where: { project: { assignments: { some: { vendorId: vendor.id } } } } }),
    prisma.vendorTrustAudit.findFirst({ where: { vendorId: vendor.id }, orderBy: { createdAt: 'desc' } }),
    // Whether anyone actually behind this account has passed real NIN
    // verification — `some` rather than picking one member, since a
    // vendor account can in principle have more than one (even though
    // in practice it almost never does: the vendor role carries no
    // account:manage_members permission to invite a second one).
    prisma.accountMember.count({
      where: { accountId: vendor.accountId, user: { identityVerificationStatus: 'verified' } },
    }),
  ]);
  const ratingAverage = vendor.ratingAverage != null ? Number(vendor.ratingAverage) : null;
  return computeVendorTrustScore({
    verificationStatus: vendor.verificationStatus,
    ratingAverage,
    reviewCount,
    completedProjects,
    disputeCount,
    latestAudit: latestAudit ? { rating: latestAudit.rating, notes: latestAudit.notes, createdAt: latestAudit.createdAt } : null,
    identityVerifiedOperator: verifiedOperatorCount > 0,
  });
}
