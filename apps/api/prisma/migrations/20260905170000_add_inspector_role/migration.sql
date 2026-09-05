CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- A distinct, narrower "inspector" role — see seed.ts's own ROLES.inspector
-- comment for why. No new permission keys: it's built entirely from a
-- smaller slice of permissions the "vendor" role already carries.
INSERT INTO "roles" ("id", "key", "name")
VALUES (gen_random_uuid()::text, 'inspector', 'inspector')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r, "permissions" p
WHERE r."key" = 'inspector' AND p."key" IN ('vendor:read', 'vendor:write', 'document:read', 'ai:act')
ON CONFLICT DO NOTHING;
