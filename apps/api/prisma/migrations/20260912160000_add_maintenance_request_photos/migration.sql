-- AlterTable
ALTER TABLE "maintenance_requests" ADD COLUMN "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "maintenance_requests" ADD COLUMN "resolutionPhotoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
