// A small, deliberately bounded boost layered on top of text-relevance
// ranking for the three pg_trgm marketplace searches (listings, vendors,
// materials) — never large enough to let a barely-relevant match beat a
// strongly-relevant one, only to break near-ties among similarly-
// relevant results in a sensible direction (newer, better-rated,
// verified). One shared, generic scoring function rather than three
// separate weightings that happen to look similar — this is bounded
// arithmetic, not domain-specific business logic, so it belongs here
// rather than duplicated per marketplace the way this codebase's own
// per-domain judgment calls (trust scores, license checks) are.
const RECENCY_WINDOW_DAYS = 90;
const MAX_RECENCY_BOOST = 0.05;
const MAX_RATING_BOOST = 0.05;
const VERIFIED_BOOST = 0.05;

export function rankingBoost(input: { createdAt: Date; ratingAverage?: number | null; isVerified?: boolean }): number {
  const ageDays = (Date.now() - input.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  const recencyBoost = Math.max(0, MAX_RECENCY_BOOST * (1 - ageDays / RECENCY_WINDOW_DAYS));
  const ratingBoost = input.ratingAverage != null ? MAX_RATING_BOOST * (Math.min(5, Math.max(0, input.ratingAverage)) / 5) : 0;
  const verifiedBoost = input.isVerified ? VERIFIED_BOOST : 0;
  return recencyBoost + ratingBoost + verifiedBoost;
}
