CREATE TABLE "document_evidence" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "fileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vendor_verification_evidence" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "fileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_verification_evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_verification_evidence" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "fileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_verification_evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "document_evidence_documentId_idx" ON "document_evidence"("documentId");
CREATE INDEX "vendor_verification_evidence_vendorId_idx" ON "vendor_verification_evidence"("vendorId");
CREATE INDEX "supplier_verification_evidence_supplierId_idx" ON "supplier_verification_evidence"("supplierId");

ALTER TABLE "document_evidence"
    ADD CONSTRAINT "document_evidence_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vendor_verification_evidence"
    ADD CONSTRAINT "vendor_verification_evidence_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "supplier_verification_evidence"
    ADD CONSTRAINT "supplier_verification_evidence_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
