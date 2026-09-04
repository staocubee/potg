-- AlterEnum
ALTER TYPE "AccountType" ADD VALUE 'TENANT';

-- AlterTable
ALTER TABLE "leases" ADD COLUMN     "tenantAccountId" TEXT;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_tenantAccountId_fkey" FOREIGN KEY ("tenantAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
