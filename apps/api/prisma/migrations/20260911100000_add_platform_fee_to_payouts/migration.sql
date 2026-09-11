-- AlterTable
ALTER TABLE "payouts" ADD COLUMN "grossAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "payouts" ADD COLUMN "platformFeeAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Backfill: every payout created before this migration had no platform
-- fee taken from it, so its full "amount" was, in fact, the gross
-- milestone value released. platformFeeAmount correctly stays 0 for
-- these historical rows.
UPDATE "payouts" SET "grossAmount" = "amount" WHERE "grossAmount" = 0;
