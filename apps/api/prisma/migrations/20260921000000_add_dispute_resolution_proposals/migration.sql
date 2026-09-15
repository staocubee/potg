-- CreateTable
CREATE TABLE "dispute_resolution_proposals" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "proposedByAccountId" TEXT NOT NULL,
    "resolutionType" TEXT NOT NULL,
    "resolutionNotes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "dispute_resolution_proposals_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "dispute_resolution_proposals" ADD CONSTRAINT "dispute_resolution_proposals_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
