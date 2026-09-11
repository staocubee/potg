import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

// Module 24's "Branch property report"/"Facility cost report" — see
// Branch's own schema comment for the full reasoning. Every method here
// is scoped by :branchId, already validated against the caller's own
// account by PermissionsGuard's own ABAC check, same trust boundary
// CommunitiesService's own comment describes for :communityId.
@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  create(accountId: string, dto: CreateBranchDto) {
    return this.prisma.branch.create({ data: { accountId, ...dto } });
  }

  findAllForAccount(accountId: string) {
    return this.prisma.branch.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { properties: true } } },
    });
  }

  async findOne(branchId: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      include: { properties: { select: { id: true, name: true, propertyType: true, status: true, estimatedValue: true } } },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  update(branchId: string, dto: UpdateBranchDto) {
    return this.prisma.branch.update({ where: { id: branchId }, data: dto });
  }

  // Deleting a branch is safe on purpose — Property.branchId is
  // onDelete: SetNull (see the schema), so every property assigned to it
  // simply becomes unassigned rather than the delete being blocked or
  // cascading into deleting properties. No confirmation-of-emptiness
  // check needed here for the same reason.
  async remove(branchId: string) {
    await this.prisma.branch.delete({ where: { id: branchId } });
    return { message: 'Branch removed.' };
  }
}
