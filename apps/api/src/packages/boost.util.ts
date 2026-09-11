import { PrismaService } from '../prisma/prisma.service';

// Shared by ListingsService/VendorsService/MaterialsService/
// PublicProfilesService's own default (non-search) browse ordering — one
// place to decide "is this account currently boosted, and by how much,"
// rather than four copies of the same live query. Deliberately NOT named
// anything with "verified" in it (isVerified/verificationStatus already
// means something else entirely on Vendor/Supplier/PropertyListing — the
// platform's own KYC-style review outcome) — this is paid placement, a
// different concept, and the badge it produces is worded distinctly in
// the web app for the same reason.
export type BoostInfo = { packageTitle: string; boostWeight: number };

// A currently-active subscription is read live (status === 'active' AND
// expiresAt in the future) rather than from a denormalized "isBoosted"
// flag on Account — see PackageSubscription's own schema comment for why
// nothing flips a stored flag when a subscription lapses.
export async function getActiveBoostMap(prisma: PrismaService): Promise<Map<string, BoostInfo>> {
  const rows = await prisma.packageSubscription.findMany({
    where: { status: 'active', expiresAt: { gt: new Date() } },
    select: { accountId: true, package: { select: { title: true, boostWeight: true } } },
  });
  const map = new Map<string, BoostInfo>();
  for (const row of rows) {
    // An account could in principle hold more than one still-active
    // subscription (e.g. renewed early, or two different tiers) — keep
    // whichever has the higher boostWeight, same tie-break the sort below
    // uses between different accounts.
    const existing = map.get(row.accountId);
    if (!existing || row.package.boostWeight > existing.boostWeight) {
      map.set(row.accountId, { packageTitle: row.package.title, boostWeight: row.package.boostWeight });
    }
  }
  return map;
}

// A single-account lookup for pages that only ever need one account's own
// boost (the public one-page-website, PackagesService's own "my active
// boost" summary) — same live "active AND not yet expired" computation as
// getActiveBoostMap above, just not worth pulling the whole platform-wide
// map for a page that only renders one account.
export async function getActiveBoostForAccount(prisma: PrismaService, accountId: string): Promise<BoostInfo | null> {
  const row = await prisma.packageSubscription.findFirst({
    where: { accountId, status: 'active', expiresAt: { gt: new Date() } },
    select: { package: { select: { title: true, boostWeight: true } } },
    orderBy: [{ package: { boostWeight: 'desc' } }, { expiresAt: 'desc' }],
  });
  return row ? { packageTitle: row.package.title, boostWeight: row.package.boostWeight } : null;
}

// Stable partition, not a full re-sort: every boosted row moves ahead of
// every non-boosted row (ordered among themselves by boostWeight, ties
// broken by Array.sort's own guaranteed-stable original order — i.e.
// whatever the caller's own orderBy already produced), and every
// non-boosted row keeps its original relative order after them. This is
// paid placement, not a relevance nudge — deliberately much stronger than
// search-ranking.util.ts's own bounded rankingBoost() tiebreak, which
// this does not touch or replace.
export function applyVisibilityBoost<T extends { accountId: string }>(
  rows: T[],
  boostMap: Map<string, BoostInfo>,
): (T & { packageBadge: BoostInfo | null })[] {
  const withBadge = rows.map((row) => ({ ...row, packageBadge: boostMap.get(row.accountId) ?? null }));
  const boosted = withBadge
    .filter((row) => row.packageBadge)
    .sort((a, b) => b.packageBadge!.boostWeight - a.packageBadge!.boostWeight);
  const rest = withBadge.filter((row) => !row.packageBadge);
  return [...boosted, ...rest];
}
