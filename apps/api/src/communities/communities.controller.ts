import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember, CurrentUser } from '../common/decorators/current-user.decorator';
import { CommunitiesService } from './communities.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { AddResidentDto } from './dto/add-resident.dto';
import { CreateCommunityAnnouncementDto } from './dto/create-community-announcement.dto';

type AccountMemberCtx = { accountId: string };
type UserCtx = { id: string };

// :communityId (not :id) is deliberate, same reasoning :propertyId/
// :projectId already establish — PermissionsGuard's own ABAC check looks
// for that exact param name to enforce tenant isolation (see its own
// comment). Every nested route below inherits that check for free.
@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller('communities')
export class CommunitiesController {
  constructor(private readonly communities: CommunitiesService) {}

  @RequirePermissions('community:write')
  @Post()
  create(@CurrentAccountMember() member: AccountMemberCtx, @Body() dto: CreateCommunityDto) {
    return this.communities.create(member.accountId, dto);
  }

  @RequirePermissions('community:read')
  @Get()
  findAll(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.communities.findAllForAccount(member.accountId);
  }

  @RequirePermissions('community:read')
  @Get(':communityId')
  findOne(@Param('communityId') communityId: string) {
    return this.communities.findOne(communityId);
  }

  @RequirePermissions('community:write')
  @Post(':communityId/residents')
  addResident(@Param('communityId') communityId: string, @Body() dto: AddResidentDto) {
    return this.communities.addResident(communityId, dto);
  }

  @RequirePermissions('community:read')
  @Get(':communityId/residents')
  findResidents(@Param('communityId') communityId: string) {
    return this.communities.findResidents(communityId);
  }

  @RequirePermissions('community:write')
  @Delete(':communityId/residents/:residentId')
  removeResident(@Param('communityId') communityId: string, @Param('residentId') residentId: string) {
    return this.communities.removeResident(communityId, residentId);
  }

  @RequirePermissions('community:write')
  @Post(':communityId/announcements')
  createAnnouncement(
    @Param('communityId') communityId: string,
    @CurrentUser() user: UserCtx,
    @Body() dto: CreateCommunityAnnouncementDto,
  ) {
    return this.communities.createAnnouncement(communityId, user.id, dto);
  }

  @RequirePermissions('community:read')
  @Get(':communityId/announcements')
  findAnnouncements(@Param('communityId') communityId: string) {
    return this.communities.findAnnouncements(communityId);
  }

  @RequirePermissions('community:write')
  @Delete(':communityId/announcements/:announcementId')
  deleteAnnouncement(@Param('communityId') communityId: string, @Param('announcementId') announcementId: string) {
    return this.communities.deleteAnnouncement(communityId, announcementId);
  }
}
