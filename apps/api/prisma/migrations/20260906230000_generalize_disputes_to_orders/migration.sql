-- AlterTable
ALTER TABLE "disputes"
  ALTER COLUMN "projectId" DROP NOT NULL,
  ADD COLUMN "orderId" TEXT,
  ADD COLUMN "disputeType" TEXT NOT NULL DEFAULT 'other';

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Module 18 Phase 1 — a supplier had no dispute permissions at all
-- before this pass (the vendor role's identical project-dispute
-- permissions already existed). See seed.ts's own ROLES.supplier entry
-- for this pass so a fresh `prisma db seed` run and this migration
-- never disagree.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE r."key" = 'supplier' AND p."key" IN ('dispute:read', 'dispute:write')
ON CONFLICT DO NOTHING;
