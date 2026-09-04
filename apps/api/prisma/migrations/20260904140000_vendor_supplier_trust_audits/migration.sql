-- CreateTable
CREATE TABLE "vendor_trust_audits" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "reviewedByUserId" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_trust_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_trust_audits" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "reviewedByUserId" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_trust_audits_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "vendor_trust_audits" ADD CONSTRAINT "vendor_trust_audits_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_trust_audits" ADD CONSTRAINT "supplier_trust_audits_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
