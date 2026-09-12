import { SetMetadata } from '@nestjs/common';

// PermissionsGuard's :projectId ownership check normally 404s any account
// other than the project's own owning account — correct for owner-only
// routes (create/complete a project, request/accept a quote), but wrong
// for the handful of routes a vendor genuinely hired onto that project
// needs to reach (viewing the project, tracking its own progress). Marking
// a route with this decorator tells the guard to also allow it through
// when the acting account is a Vendor with a real ProjectVendorAssignment
// on that exact project — real ABAC on the assignment, not just RBAC on
// the vendor role, so a vendor still can't reach a project it was never
// hired onto.
export const ALLOW_ASSIGNED_VENDOR_KEY = 'allowAssignedVendor';
export const AllowAssignedVendor = () => SetMetadata(ALLOW_ASSIGNED_VENDOR_KEY, true);
