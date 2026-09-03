-- CreateTable
CREATE TABLE "dispute_evidence" (
    "id" TEXT NOT NULL,
    "disputeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "fileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
