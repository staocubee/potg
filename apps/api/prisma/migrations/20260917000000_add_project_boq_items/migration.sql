-- CreateTable
CREATE TABLE "project_boq_items" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit" TEXT,
    "estimatedUnitCost" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_boq_items_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "project_boq_items" ADD CONSTRAINT "project_boq_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
