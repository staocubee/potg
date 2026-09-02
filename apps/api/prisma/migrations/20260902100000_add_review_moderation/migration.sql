-- AlterTable
ALTER TABLE "vendor_reviews" ADD COLUMN "moderationStatus" TEXT NOT NULL DEFAULT 'published';
ALTER TABLE "vendor_reviews" ADD COLUMN "flagReason" TEXT;
ALTER TABLE "vendor_reviews" ADD COLUMN "flaggedAt" TIMESTAMP(3);
ALTER TABLE "vendor_reviews" ADD COLUMN "moderationNotes" TEXT;
ALTER TABLE "vendor_reviews" ADD COLUMN "moderatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "supplier_reviews" ADD COLUMN "moderationStatus" TEXT NOT NULL DEFAULT 'published';
ALTER TABLE "supplier_reviews" ADD COLUMN "flagReason" TEXT;
ALTER TABLE "supplier_reviews" ADD COLUMN "flaggedAt" TIMESTAMP(3);
ALTER TABLE "supplier_reviews" ADD COLUMN "moderationNotes" TEXT;
ALTER TABLE "supplier_reviews" ADD COLUMN "moderatedAt" TIMESTAMP(3);
