-- CreateTable
CREATE TABLE "listing_sales" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "buyerAccountId" TEXT NOT NULL,
    "sellerAccountId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "depositRecordedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_sales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "listing_sales_listingId_key" ON "listing_sales"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "listing_sales_offerId_key" ON "listing_sales"("offerId");

-- AddForeignKey
ALTER TABLE "listing_sales" ADD CONSTRAINT "listing_sales_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "property_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_sales" ADD CONSTRAINT "listing_sales_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "listing_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
