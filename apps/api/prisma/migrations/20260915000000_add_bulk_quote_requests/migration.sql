-- CreateTable
CREATE TABLE "bulk_quote_requests" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "projectId" TEXT,
    "quantity" INTEGER NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "quotedUnitPrice" DECIMAL(14,2),
    "quotedNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bulk_quote_requests_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "bulk_quote_requests" ADD CONSTRAINT "bulk_quote_requests_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_quote_requests" ADD CONSTRAINT "bulk_quote_requests_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_quote_requests" ADD CONSTRAINT "bulk_quote_requests_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_quote_requests" ADD CONSTRAINT "bulk_quote_requests_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
