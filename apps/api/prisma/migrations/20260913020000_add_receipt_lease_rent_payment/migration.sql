-- AlterTable
ALTER TABLE "receipts" ADD COLUMN "leaseRentPaymentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "receipts_leaseRentPaymentId_key" ON "receipts"("leaseRentPaymentId");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_leaseRentPaymentId_fkey" FOREIGN KEY ("leaseRentPaymentId") REFERENCES "lease_rent_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
