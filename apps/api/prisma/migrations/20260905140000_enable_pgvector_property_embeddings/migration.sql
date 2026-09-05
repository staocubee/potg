-- Enables pgvector and creates a table for OpenAI property embeddings.
-- No ANN index (ivfflat/hnsw) — row counts at this scale don't need one;
-- a plain cosine-distance ORDER BY is fast enough, see PropertiesService.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "property_embeddings" (
    "propertyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_embeddings_pkey" PRIMARY KEY ("propertyId")
);

ALTER TABLE "property_embeddings"
    ADD CONSTRAINT "property_embeddings_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "property_embeddings_accountId_idx" ON "property_embeddings"("accountId");
