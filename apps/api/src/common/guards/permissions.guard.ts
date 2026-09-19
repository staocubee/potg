import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ALLOW_ASSIGNED_VENDOR_KEY } from '../decorators/allow-assigned-vendor.decorator';
import { PrismaService } from '../../prisma/prisma.service';

// RBAC baseline + ABAC tenant isolation in one guard, per Section 8:
// "Use RBAC as the baseline and ABAC for ownership, branch, property,
// project, and transaction-level restrictions." Must run after
// AccountContextGuard. The AI layer (ai.service.ts) enforces the identical
// rule before it assembles context for a request — it is not a separate
// permission system layered on top.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const accountMember = req.accountMember;
    if (!accountMember) {
      throw new ForbiddenException('No account context — AccountContextGuard must run first');
    }

    const granted: Set<string> = new Set(
      accountMember.role.permissions.map((rp: { permission: { key: string } }) => rp.permission.key),
    );
    const missing = required.filter((p) => !granted.has(p));
    if (missing.length > 0) {
      // Every page across the app renders this message verbatim in its
      // own error banner (err.message from ApiError) — used to be the
      // raw permission key ("Missing permission(s): property:read"),
      // developer-facing jargon nobody outside this codebase would
      // recognize. Permission.label is the same human-readable text the
      // seed data already carries for exactly this reason; every real
      // @RequirePermissions() call in this codebase names exactly one
      // permission (confirmed — none pass more than one), so the common
      // case reads as one plain sentence. The join fallback only matters
      // if that ever changes.
      const permissions = await this.prisma.permission.findMany({ where: { key: { in: missing } } });
      const labels = missing.map((key) => permissions.find((p) => p.key === key)?.label ?? key);
      const message =
        labels.length === 1
          ? `You don't have permission to ${labels[0].charAt(0).toLowerCase()}${labels[0].slice(1)}.`
          : `This action needs permissions your account doesn't have: ${labels.join(', ')}.`;
      throw new ForbiddenException(message);
    }

    // Tenant isolation: a route touching a specific property must only see
    // a property that belongs to the acting account. 404, not 403 — don't
    // confirm to the caller that a property outside their account exists.
    const propertyId = req.params?.propertyId;
    if (propertyId) {
      const property = await this.prisma.property.findUnique({ where: { id: propertyId } });
      if (!property || property.accountId !== accountMember.accountId) {
        throw new NotFoundException('Property not found');
      }
    }

    // Same pattern for :projectId (Modules 7/9), plus a real ABAC
    // extension: a route marked @AllowAssignedVendor() also lets through
    // an account that isn't the project's owner, provided it's a Vendor
    // with an actual ProjectVendorAssignment on this exact project — a
    // vendor hired onto project A still 404s on project B. Every other
    // :projectId route (create milestones, request/accept a quote,
    // complete the project) stays owner-account-only, unchanged.
    const projectId = req.params?.projectId;
    if (projectId) {
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });
      if (!project) throw new NotFoundException('Project not found');
      if (project.accountId !== accountMember.accountId) {
        const allowAssignedVendor = this.reflector.getAllAndOverride<boolean>(ALLOW_ASSIGNED_VENDOR_KEY, [
          context.getHandler(),
          context.getClass(),
        ]);
        const assignment = allowAssignedVendor
          ? await this.prisma.projectVendorAssignment.findFirst({
              where: { projectId, vendor: { accountId: accountMember.accountId } },
            })
          : null;
        if (!assignment) throw new NotFoundException('Project not found');
      }
    }

    // Same pattern for :communityId (Module 17) — a Community is an
    // account-owned top-level resource exactly like Property/Project
    // above, so it gets the identical isolation check rather than each
    // CommunitiesService method re-validating ownership by hand.
    const communityId = req.params?.communityId;
    if (communityId) {
      const community = await this.prisma.community.findUnique({ where: { id: communityId } });
      if (!community || community.accountId !== accountMember.accountId) {
        throw new NotFoundException('Community not found');
      }
    }

    // Same pattern for :branchId (Module 24's Branch/Facility reports) —
    // a Branch is an account-owned top-level resource exactly like
    // Community above.
    const branchId = req.params?.branchId;
    if (branchId) {
      const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
      if (!branch || branch.accountId !== accountMember.accountId) {
        throw new NotFoundException('Branch not found');
      }
    }

    // Same pattern for :accountId (Module 1) — no extra query needed since
    // AccountContextGuard already resolved which account the caller is
    // acting as. Without this, POST /accounts/:accountId/members had a real
    // IDOR: account:manage_members only ever checked that the caller had
    // that permission *somewhere* (on whatever account X-Account-Id named),
    // never that it was for *this* account — so any account owner could add
    // themselves, with any role, to any other account on the platform just
    // by putting a different id in the URL. Found and fixed in the same
    // pass that added the invite flow below.
    const accountIdParam = req.params?.accountId;
    if (accountIdParam && accountIdParam !== accountMember.accountId) {
      throw new NotFoundException('Account not found');
    }

    return true;
  }
}
