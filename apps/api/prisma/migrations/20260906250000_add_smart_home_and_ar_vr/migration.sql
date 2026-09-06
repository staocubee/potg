-- AlterTable
ALTER TABLE "renovation_visualizations" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'renovation';

-- CreateTable
CREATE TABLE "property_devices" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT,
    "status" TEXT NOT NULL DEFAULT 'not_connected',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_tour_assets" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "mediaUrl" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL DEFAULT 'photo_360',
    "label" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_tour_assets_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "property_devices" ADD CONSTRAINT "property_devices_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_tour_assets" ADD CONSTRAINT "property_tour_assets_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
