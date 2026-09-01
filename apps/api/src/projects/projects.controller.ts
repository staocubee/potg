import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember, CurrentUser } from '../common/decorators/current-user.decorator';
import { ProjectsService } from './projects.service';
import { VendorsService } from '../vendors/vendors.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { AddMilestoneDto } from './dto/add-milestone.dto';
import { AddProjectUpdateDto } from './dto/add-project-update.dto';
import { RequestQuoteDto } from './dto/request-quote.dto';
import { CreateVendorReviewDto } from '../vendors/dto/create-vendor-review.dto';

type AccountMemberCtx = { accountId: string };
type UserCtx = { id: string };

@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly vendors: VendorsService,
  ) {}

  @RequirePermissions('project:write')
  @Post()
  create(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: CreateProjectDto) {
    return this.projects.create(member.accountId, dto);
  }

  @RequirePermissions('project:read')
  @Get()
  findAll(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.projects.findAllForAccount(member.accountId);
  }

  // :projectId is deliberate — PermissionsGuard's ABAC check looks for that
  // exact param name (mirrors :propertyId) to enforce tenant isolation.
  @RequirePermissions('project:read')
  @Get(':projectId')
  findOne(@Param('projectId') projectId: string) {
    return this.projects.findOne(projectId);
  }

  @RequirePermissions('milestone:write')
  @Post(':projectId/milestones')
  addMilestone(@Param('projectId') projectId: string, @Body() dto: AddMilestoneDto) {
    return this.projects.addMilestone(projectId, dto);
  }

  @RequirePermissions('project:write')
  @Post(':projectId/updates')
  addUpdate(
    @Param('projectId') projectId: string,
    @CurrentUser() user: UserCtx,
    @Body() dto: AddProjectUpdateDto,
  ) {
    return this.projects.addUpdate(projectId, user.id, dto);
  }

  @RequirePermissions('quote:write')
  @Post(':projectId/quotes/request')
  requestQuote(@Param('projectId') projectId: string, @Body() dto: RequestQuoteDto) {
    return this.projects.requestQuote(projectId, dto);
  }

  @RequirePermissions('quote:write')
  @Post(':projectId/quotes/:quoteId/accept')
  acceptQuote(@Param('projectId') projectId: string, @Param('quoteId') quoteId: string) {
    return this.projects.acceptQuote(projectId, quoteId);
  }

  // Owner-only, mirrors the other project-lifecycle actions above — the
  // gate ProjectsService.complete checks before flipping status, and in
  // turn what VendorsService.createReview below requires before a review
  // can be left on this project's vendor.
  @RequirePermissions('project:write')
  @Post(':projectId/complete')
  complete(@Param('projectId') projectId: string) {
    return this.projects.complete(projectId);
  }

  @RequirePermissions('review:write')
  @Post(':projectId/reviews')
  reviewVendor(
    @Param('projectId') projectId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: CreateVendorReviewDto,
  ) {
    return this.vendors.createReview(projectId, member.accountId, dto);
  }
}
