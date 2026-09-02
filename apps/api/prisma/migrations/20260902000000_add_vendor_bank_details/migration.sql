-- AlterTable
ALTER TABLE "vendors" ADD COLUMN "bankAccountNumber" TEXT;
ALTER TABLE "vendors" ADD COLUMN "bankCode" TEXT;
ALTER TABLE "vendors" ADD COLUMN "bankAccountName" TEXT;
ALTER TABLE "vendors" ADD COLUMN "paystackRecipientCode" TEXT;

-- AlterTable
ALTER TABLE "payouts" ADD COLUMN "providerReference" TEXT;
