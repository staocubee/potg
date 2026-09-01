import { SetMetadata } from '@nestjs/common';

// Section 8 ("User Roles and Permissions") lists Permission Areas —
// properties, documents, projects, payments, escrow, ai, etc. Permission
// keys here follow "<area>:<action>", e.g. "property:read",
// "payment:approve", "ai:act". Seed data (prisma/seed.ts) is the source of
// truth for which keys exist and which roles carry them.
export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
