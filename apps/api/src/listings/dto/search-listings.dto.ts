// Query params for GET /listings — validated by hand in the controller
// rather than a class-validator DTO, since every field is an optional
// query string. Mirrors VendorsController's ?serviceCategory pattern, just
// with more filters (Priority 5's "search" requirement).
export interface SearchListingsQuery {
  listingType?: string;
  city?: string;
  propertyType?: string;
  minPrice?: string;
  maxPrice?: string;
  // Free-text, matched fuzzily (pg_trgm) against title/description — see
  // ListingsService.findAll's own comment for why. Optional: every
  // existing exact filter above still works with or without it.
  q?: string;
}
