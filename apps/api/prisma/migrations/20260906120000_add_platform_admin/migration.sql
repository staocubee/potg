-- CreateTable
CREATE TABLE "platform_admin_actions" (
    "id" TEXT NOT NULL,
    "targetAccountId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "performedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admin_actions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "platform_admin_actions" ADD CONSTRAINT "platform_admin_actions_targetAccountId_fkey" FOREIGN KEY ("targetAccountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- New permissions, granted only to platform_admin — a new role, distinct
-- from platform_reviewer: trust & safety reviews one vendor/supplier/
-- dispute/document/review at a time, this operates on accounts
-- platform-wide. Mirrors seed.ts's own PERMISSIONS/ROLES entries for
-- this pass so a fresh `prisma db seed` run and this migration never
-- disagree.
INSERT INTO "permissions" ("id", "key", "label")
VALUES
  (gen_random_uuid()::text, 'account:read_all', 'View every account platform-wide (platform admin only)'),
  (gen_random_uuid()::text, 'account:suspend', 'Suspend or reinstate any account platform-wide (platform admin only)')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "roles" ("id", "key", "name")
VALUES (gen_random_uuid()::text, 'platform_admin', 'platform admin')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE r."key" = 'platform_admin' AND p."key" IN ('account:read_all', 'account:suspend')
ON CONFLICT DO NOTHING;
