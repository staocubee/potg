-- Enables typo-tolerant, substring-free "search" across the three
-- marketplaces (Listings/Vendors/Materials) that had zero free-text
-- search before this — see ListingsService.findAll/VendorsService.
-- findAll/MaterialsService.findProducts's own new `q` handling. Chosen
-- over standing up a real Elasticsearch/OpenSearch cluster: this scaffold
-- already has Postgres, pg_trgm ships with it, and at this data volume a
-- second search-specific datastore to keep in sync would be pure
-- overhead, not a real capability gain.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram indexes — what makes `%` (similarity) and `ILIKE` queries
-- against these columns fast instead of a sequential scan per search.
CREATE INDEX "property_listings_title_trgm_idx" ON "property_listings" USING gin ("title" gin_trgm_ops);
CREATE INDEX "property_listings_description_trgm_idx" ON "property_listings" USING gin ("description" gin_trgm_ops);
CREATE INDEX "vendors_business_name_trgm_idx" ON "vendors" USING gin ("businessName" gin_trgm_ops);
CREATE INDEX "products_name_trgm_idx" ON "products" USING gin ("name" gin_trgm_ops);
CREATE INDEX "products_description_trgm_idx" ON "products" USING gin ("description" gin_trgm_ops);
