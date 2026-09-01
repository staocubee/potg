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
}
