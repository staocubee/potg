-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "licenseNumber" TEXT;
ALTER TABLE "vendors" ADD COLUMN     "licenseIssuingBody" TEXT;
ALTER TABLE "vendors" ADD COLUMN     "licenseExpiresAt" TIMESTAMP(3);
