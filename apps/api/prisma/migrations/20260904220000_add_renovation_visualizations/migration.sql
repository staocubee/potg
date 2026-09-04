-- CreateTable
CREATE TABLE "renovation_visualizations" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "projectId" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "beforeImageUrl" TEXT NOT NULL,
    "afterImageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "renovation_visualizations_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "renovation_visualizations" ADD CONSTRAINT "renovation_visualizations_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renovation_visualizations" ADD CONSTRAINT "renovation_visualizations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
