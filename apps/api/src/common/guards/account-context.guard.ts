import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// A user can belong to several accounts at once (personal, family, company,
// vendor — Module 1). This guard resolves which one the request is acting
// as from the X-Account-Id header and loads that membership's role +
// permissions once, so PermissionsGuard, route handlers, and the AI layer's
// context assembly (Section 5.4) all read the same req.accountMember
// instead of re-querying it. Must run after JwtAuthGuard.
@Injectable()
export class AccountContextGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const accountId: string | undefined = req.headers['x-account-id'];
    if (!accountId) {
      throw new ForbiddenException('Missing X-Account-Id header — choose which account you are acting as');
    }
    if (!req.user) {
      throw new ForbiddenException('Not authenticated');
    }

    const accountMember = await this.prisma.accountMember.findUnique({
      where: { accountId_userId: { accountId, userId: req.user.id } },
      include: {
        account: true,
        role: { include: { permissions: { include: { permission: true } } } },
      },
    });

    if (!accountMember || accountMember.status !== 'active') {
      throw new ForbiddenException('You are not an active member of this account');
    }

    req.accountMember = accountMember;
    req.account = accountMember.account;
    return true;
  }
}
