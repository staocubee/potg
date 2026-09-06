-- AlterTable
ALTER TABLE "properties"
  ADD COLUMN "bedrooms" INTEGER,
  ADD COLUMN "bathrooms" INTEGER,
  ADD COLUMN "squareFootage" DOUBLE PRECISION,
  ADD COLUMN "yearBuilt" INTEGER,
  ADD COLUMN "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
