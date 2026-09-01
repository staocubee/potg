// Placeholder unit costs for the "estimate project budget" skill (Module 9's
// AI Assistance: "generate a rough Bill of Quantities from a scope
// description"). Real per-market, per-material pricing is a catalog/pricing
// feed problem (Module 10) — this is a deterministic stand-in so the skill
// produces a real, explainable number without needing that catalog wired up
// yet. Keys are matched as whole words against the scope description.
export const SCOPE_ITEM_COSTS: Record<string, { label: string; unitCost: number }> = {
  cabinet: { label: 'Cabinetry', unitCost: 450000 },
  countertop: { label: 'Countertop', unitCost: 280000 },
  tile: { label: 'Tiling', unitCost: 180000 },
  paint: { label: 'Painting', unitCost: 120000 },
  plumbing: { label: 'Plumbing works', unitCost: 350000 },
  electrical: { label: 'Electrical works', unitCost: 300000 },
  roofing: { label: 'Roofing', unitCost: 600000 },
  flooring: { label: 'Flooring', unitCost: 400000 },
  landscaping: { label: 'Landscaping', unitCost: 250000 },
  labor: { label: 'General labor', unitCost: 200000 },
};

// "keyword" is carried alongside label/unitCost so callers matching against
// a real product catalog (boq_to_order) have a cleaner search term than
// deriving one from the display label — "labor" rather than the first word
// of "General labor".
export function matchScopeItems(
  scopeDescription: string,
): { keyword: string; label: string; unitCost: number }[] {
  const lower = scopeDescription.toLowerCase();
  return Object.entries(SCOPE_ITEM_COSTS)
    .filter(([keyword]) => new RegExp(`\\b${keyword}s?\\b`).test(lower))
    .map(([keyword, item]) => ({ keyword, ...item }));
}
