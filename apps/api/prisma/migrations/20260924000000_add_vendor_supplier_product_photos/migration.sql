-- AlterTable
ALTER TABLE "vendors" ADD COLUMN "photoUrl" TEXT;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN "photoUrl" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN "photoUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
