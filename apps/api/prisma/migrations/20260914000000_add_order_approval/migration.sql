-- AlterTable
ALTER TABLE "orders" ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'not_requested';
ALTER TABLE "orders" ADD COLUMN "approvalNotes" TEXT;
