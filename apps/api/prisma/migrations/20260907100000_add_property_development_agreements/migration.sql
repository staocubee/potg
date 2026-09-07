-- CreateTable
CREATE TABLE "property_development_agreements" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "proposedByUserId" TEXT NOT NULL,
    "developerEmail" TEXT NOT NULL,
    "developerAccountId" TEXT,
    "agreementType" TEXT NOT NULL,
    "ownershipPercentage" DECIMAL(5,2),
    "termMonths" INTEGER,
    "proceedsSharePercentage" DECIMAL(5,2),
    "terms" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_development_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "property_development_agreements_tokenHash_key" ON "property_development_agreements"("tokenHash");

-- AddForeignKey
ALTER TABLE "property_development_agreements" ADD CONSTRAINT "property_development_agreements_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_development_agreements" ADD CONSTRAINT "property_development_agreements_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
