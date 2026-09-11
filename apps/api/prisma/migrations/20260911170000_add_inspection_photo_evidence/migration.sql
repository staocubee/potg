-- AlterTable
ALTER TABLE "property_inspections" ADD COLUMN "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "inspection_findings" ADD COLUMN "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
