-- AlterTable
ALTER TABLE "maintenance_requests" ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'not_requested';
ALTER TABLE "maintenance_requests" ADD COLUMN "approvalNotes" TEXT;
