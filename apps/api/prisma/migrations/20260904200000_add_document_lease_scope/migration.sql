-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "leaseId" TEXT;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "leases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
