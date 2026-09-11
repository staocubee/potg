import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember } from '../common/decorators/current-user.decorator';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

type AccountMemberCtx = { accountId: string };

// :branchId (not :id) is deliberate — PermissionsGuard's own ABAC check
// looks for that exact param name to enforce tenant isolation, same
// reasoning :communityId/:propertyId/:projectId already establish.
@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @RequirePermissions('branch:write')
  @Post()
  create(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: CreateBranchDto) {
    return this.branches.create(member.accountId, dto);
  }

  @RequirePermissions('branch:read')
  @Get()
  findAll(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.branches.findAllForAccount(member.accountId);
  }

  @RequirePermissions('branch:read')
  @Get(':branchId')
  findOne(@Param('branchId') branchId: string) {
    return this.branches.findOne(branchId);
  }

  @RequirePermissions('branch:write')
  @Patch(':branchId')
  update(@Param('branchId') branchId: string, @Body() dto: UpdateBranchDto) {
    return this.branches.update(branchId, dto);
  }

  @RequirePermissions('branch:write')
  @Delete(':branchId')
  remove(@Param('branchId') branchId: string) {
    return this.branches.remove(branchId);
  }
}
