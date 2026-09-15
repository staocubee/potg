-- CreateTable
CREATE TABLE "lease_rent_schedule_entries" (
    "id" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'due',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lease_rent_schedule_entries_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "lease_rent_payments" ADD COLUMN "scheduleEntryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "lease_rent_payments_scheduleEntryId_key" ON "lease_rent_payments"("scheduleEntryId");

-- AddForeignKey
ALTER TABLE "lease_rent_schedule_entries" ADD CONSTRAINT "lease_rent_schedule_entries_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "leases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_rent_payments" ADD CONSTRAINT "lease_rent_payments_scheduleEntryId_fkey" FOREIGN KEY ("scheduleEntryId") REFERENCES "lease_rent_schedule_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
