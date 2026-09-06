-- CreateTable
CREATE TABLE "property_announcements" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "propertyId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_announcements_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "property_announcements" ADD CONSTRAINT "property_announcements_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_announcements" ADD CONSTRAINT "property_announcements_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
