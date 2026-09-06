import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { AddResidentDto } from './dto/add-resident.dto';
import { CreateCommunityAnnouncementDto } from './dto/create-community-announcement.dto';

// Module 17, Phase 1 — Communities, Residents, and Community
// Announcements. Every method below is scoped by :communityId, already
// validated against the caller's own account by PermissionsGuard's own
// ABAC check (see its comment) — no method here re-checks ownership by
// hand, same trust boundary Property/Project's own nested resources
// (valuations, milestones, ...) already rely on.
@Injectable()
export class CommunitiesService {
  constructor(private readonly prisma: PrismaService) {}

  create(accountId: string, dto: CreateCommunityDto) {
    return this.prisma.community.create({ data: { accountId, ...dto } });
  }

  findAllForAccount(accountId: string) {
    return this.prisma.community.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(communityId: string) {
    const community = await this.prisma.community.findUnique({
      where: { id: communityId },
      include: {
        residents: { orderBy: { createdAt: 'desc' } },
        announcements: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!community) throw new NotFoundException('Community not found');
    return community;
  }

  addResident(communityId: string, dto: AddResidentDto) {
    return this.prisma.resident.create({ data: { communityId, ...dto } });
  }

  findResidents(communityId: string) {
    return this.prisma.resident.findMany({
      where: { communityId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async removeResident(communityId: string, residentId: string) {
    const resident = await this.prisma.resident.findUnique({ where: { id: residentId } });
    if (!resident || resident.communityId !== communityId) {
      throw new NotFoundException('Resident not found');
    }
    await this.prisma.resident.delete({ where: { id: residentId } });
    return { deleted: true };
  }

  createAnnouncement(communityId: string, createdByUserId: string, dto: CreateCommunityAnnouncementDto) {
    return this.prisma.communityAnnouncement.create({
      data: { communityId, createdByUserId, title: dto.title, body: dto.body },
    });
  }

  findAnnouncements(communityId: string) {
    return this.prisma.communityAnnouncement.findMany({
      where: { communityId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteAnnouncement(communityId: string, announcementId: string) {
    const announcement = await this.prisma.communityAnnouncement.findUnique({ where: { id: announcementId } });
    if (!announcement || announcement.communityId !== communityId) {
      throw new NotFoundException('Announcement not found');
    }
    await this.prisma.communityAnnouncement.delete({ where: { id: announcementId } });
    return { deleted: true };
  }
}
