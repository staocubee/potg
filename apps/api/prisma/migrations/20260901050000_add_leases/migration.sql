-- CreateTable
CREATE TABLE "leases" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "tenantName" TEXT NOT NULL,
    "tenantEmail" TEXT,
    "tenantPhone" TEXT,
    "rentAmount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "rentFrequency" TEXT NOT NULL,
    "depositAmount" DECIMAL(14,2),
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lease_rent_payments" (
    "id" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'manual',
    "notes" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lease_rent_payments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_rent_payments" ADD CONSTRAINT "lease_rent_payments_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "leases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
