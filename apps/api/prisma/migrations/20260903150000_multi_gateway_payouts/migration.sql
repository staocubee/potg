-- AlterTable
ALTER TABLE "vendors" ADD COLUMN     "payoutProvider" TEXT;
ALTER TABLE "vendors" ADD COLUMN     "paypalPayoutEmail" TEXT;

-- Backfill: any vendor with bank details on file already got them
-- resolved against Paystack specifically (the only gateway
-- setBankDetails could call before this migration).
UPDATE "vendors" SET "payoutProvider" = 'paystack' WHERE "bankAccountNumber" IS NOT NULL AND "bankCode" IS NOT NULL;

-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'manual';

-- Backfill: every existing "bank_transfer" payout was created before any
-- gateway but Paystack could produce one, so it was Paystack.
UPDATE "payouts" SET "provider" = 'paystack' WHERE "payoutMethod" = 'bank_transfer';
