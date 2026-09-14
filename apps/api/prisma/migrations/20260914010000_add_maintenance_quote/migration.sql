-- AlterTable
ALTER TABLE "maintenance_requests" ADD COLUMN "quotedAmount" DECIMAL(14,2);
ALTER TABLE "maintenance_requests" ADD COLUMN "quotedCurrency" TEXT;
ALTER TABLE "maintenance_requests" ADD COLUMN "quotedNotes" TEXT;
ALTER TABLE "maintenance_requests" ADD COLUMN "quotedAt" TIMESTAMP(3);
