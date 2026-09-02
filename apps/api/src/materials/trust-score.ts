import { PrismaService } from '../prisma/prisma.service';

export type SupplierTrustFactors = {
  verificationStatus: string;
  ratingAverage: number | null;
  reviewCount: number;
  deliveredOrders: number;
  cancelledOrders: number;
};

export type SupplierTrustScore = {
  score: number;
  band: 'excellent' | 'good' | 'fair' | 'caution';
  factors: SupplierTrustFactors;
};

// The materials-marketplace counterpart to vendors/trust-score.ts —
// same formula shape, swapped for supplier-appropriate signals: delivered
// orders stand in for completed projects (a positive track-record
// signal), cancelled orders stand in for disputes (the negative signal —
// suppliers have no Dispute-equivalent model, an order actually being
// cancelled is the closest analogue to "something went wrong"). Shared
// between MaterialsService (GET /suppliers/:id and .../me) and the
// explain_supplier_trust_score AI skill. Same "not a neutral reviewer"
// limitation as the vendor score — see README.
export function computeSupplierTrustScore(factors: SupplierTrustFactors): SupplierTrustScore {
  let score = 50;
  if (factors.verificationStatus === 'verified') score += 20;
  else if (factors.verificationStatus === 'pending') score += 5;

  if (factors.ratingAverage != null) score += (factors.ratingAverage - 3) * 10;

  score += Math.min(factors.deliveredOrders * 2, 15);
  score -= Math.min(factors.cancelledOrders * 8, 30);
  score = Math.max(0, Math.min(100, Math.round(score)));

  const band = score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'fair' : 'caution';
  return { score, band, factors };
}

export async function getSupplierTrustScore(
  prisma: PrismaService,
  supplier: { id: string; verificationStatus: string; ratingAverage: unknown },
): Promise<SupplierTrustScore> {
  const [reviewCount, deliveredOrders, cancelledOrders] = await Promise.all([
    prisma.supplierReview.count({ where: { supplierId: supplier.id, moderationStatus: { not: 'hidden' } } }),
    prisma.order.count({ where: { supplierId: supplier.id, status: 'delivered' } }),
    prisma.order.count({ where: { supplierId: supplier.id, status: 'cancelled' } }),
  ]);
  const ratingAverage = supplier.ratingAverage != null ? Number(supplier.ratingAverage) : null;
  return computeSupplierTrustScore({
    verificationStatus: supplier.verificationStatus,
    ratingAverage,
    reviewCount,
    deliveredOrders,
    cancelledOrders,
  });
}
