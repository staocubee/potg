CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "compliance_items" (
    "id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_items_pkey" PRIMARY KEY ("id")
);

-- New permissions, granted only to platform_reviewer — same isolation
-- every other neutral-reviewer permission already uses (vendor:verify,
-- dispute:arbitrate, ...): the role that owns this data never gets it,
-- and no tenant-facing role is touched by this migration at all. Mirrors
-- seed.ts's own PERMISSIONS/ROLES entries for this pass so a fresh
-- `prisma db seed` run and this migration never disagree.
INSERT INTO "permissions" ("id", "key", "label")
VALUES
  (gen_random_uuid()::text, 'compliance:read', 'View the platform compliance tracker (neutral reviewer only)'),
  (gen_random_uuid()::text, 'compliance:write', 'Edit the platform compliance tracker (neutral reviewer only)')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE r."key" = 'platform_reviewer' AND p."key" IN ('compliance:read', 'compliance:write')
ON CONFLICT DO NOTHING;
