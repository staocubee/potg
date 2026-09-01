import { PrismaService } from '../prisma/prisma.service';

export type VendorTrustFactors = {
  verificationStatus: string;
  ratingAverage: number | null;
  reviewCount: number;
  completedProjects: number;
  disputeCount: number;
};

export type VendorTrustScore = {
  score: number;
  band: 'excellent' | 'good' | 'fair' | 'caution';
  factors: VendorTrustFactors;
};

// Module 6's "trust score" — a deterministic read of data the platform
// already has (verification status, review ratings, completed project
// count, disputes on projects it worked). Shared between VendorsService
// (attached to GET /vendors/:id and .../me) and the explain_vendor_trust_
// score AI skill so both read the exact same formula. Deliberately still
// not what Module 6's "neutral reviewer" calls for — reviews come from the
// accounts that hired the vendor, not an independent auditor, same
// limitation document verification and dispute resolution both already
// carry (see README).
export function computeVendorTrustScore(factors: VendorTrustFactors): VendorTrustScore {
  let score = 50;
  if (factors.verificationStatus === 'verified') score += 20;
  else if (factors.verificationStatus === 'pending') score += 5;

  if (factors.ratingAverage != null) score += (factors.ratingAverage - 3) * 10;

  score += Math.min(factors.completedProjects * 3, 15);
  score -= Math.min(factors.disputeCount * 8, 30);
  score = Math.max(0, Math.min(100, Math.round(score)));

  const band = score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'fair' : 'caution';
  return { score, band, factors };
}

export async function getVendorTrustScore(
  prisma: PrismaService,
  vendor: { id: string; verificationStatus: string; ratingAverage: unknown },
): Promise<VendorTrustScore> {
  const [reviewCount, completedProjects, disputeCount] = await Promise.all([
    prisma.vendorReview.count({ where: { vendorId: vendor.id } }),
    prisma.projectVendorAssignment.count({ where: { vendorId: vendor.id, project: { status: 'completed' } } }),
    prisma.dispute.count({ where: { project: { assignments: { some: { vendorId: vendor.id } } } } }),
  ]);
  const ratingAverage = vendor.ratingAverage != null ? Number(vendor.ratingAverage) : null;
  return computeVendorTrustScore({
    verificationStatus: vendor.verificationStatus,
    ratingAverage,
    reviewCount,
    completedProjects,
    disputeCount,
  });
}
