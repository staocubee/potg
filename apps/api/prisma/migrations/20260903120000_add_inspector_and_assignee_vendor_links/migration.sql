-- AlterTable
ALTER TABLE "property_inspections" ADD COLUMN     "inspectorVendorId" TEXT;

-- AlterTable
ALTER TABLE "maintenance_requests" ADD COLUMN     "assignedVendorId" TEXT;

-- AddForeignKey
ALTER TABLE "property_inspections" ADD CONSTRAINT "property_inspections_inspectorVendorId_fkey" FOREIGN KEY ("inspectorVendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_assignedVendorId_fkey" FOREIGN KEY ("assignedVendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
