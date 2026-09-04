-- AlterTable
ALTER TABLE "users" ADD COLUMN     "identityVerificationStatus" TEXT NOT NULL DEFAULT 'not_verified';
ALTER TABLE "users" ADD COLUMN     "identityVerificationNotes" TEXT;
ALTER TABLE "users" ADD COLUMN     "identityVerifiedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN     "ninLast4" TEXT;
