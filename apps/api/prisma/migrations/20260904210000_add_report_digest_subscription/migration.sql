-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "reportDigestFrequency" TEXT NOT NULL DEFAULT 'off';
ALTER TABLE "accounts" ADD COLUMN     "reportDigestLastSentAt" TIMESTAMP(3);
