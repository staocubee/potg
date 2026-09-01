import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
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
      throw new ForbiddenException(`Missing permission(s): ${missing.join(', ')}`);
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

    // Same pattern for :projectId (Modules 7/9). This only covers the
    // project-owner's own routes (create milestones/updates, request or
    // accept a quote) — a vendor acting on a project it doesn't own (e.g.
    // submitting a quote) goes through a route that doesn't key on
    // :projectId, so this check never has to allow "someone else's project"
    // through. See ProjectsModule/VendorsModule for which is which.
    const projectId = req.params?.projectId;
    if (projectId) {
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });
      if (!project || project.accountId !== accountMember.accountId) {
        throw new NotFoundException('Project not found');
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
