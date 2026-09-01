import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { AddMemberDto } from './dto/add-member.dto';

// The role a user creating a new account is granted automatically —
// mirrors Section 8's core roles. Seed data (prisma/seed.ts) must define a
// Role with each of these keys.
const DEFAULT_OWNER_ROLE_BY_ACCOUNT_TYPE: Record<string, string> = {
  INDIVIDUAL: 'property_owner',
  FAMILY: 'family_admin',
  COMPANY: 'company_admin',
  VENDOR: 'vendor',
  SUPPLIER: 'supplier',
};

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateAccountDto) {
    const roleKey = DEFAULT_OWNER_ROLE_BY_ACCOUNT_TYPE[dto.accountType];
    const role = await this.prisma.role.findUnique({ where: { key: roleKey } });
    if (!role) {
      throw new BadRequestException(
        `Role "${roleKey}" is not seeded — run the seed script before creating a ${dto.accountType} account.`,
      );
    }

    return this.prisma.account.create({
      data: {
        accountType: dto.accountType as any,
        name: dto.name,
        country: dto.country,
        currency: dto.currency,
        timezone: dto.timezone,
        members: {
          create: { userId, roleId: role.id },
        },
      },
      include: { members: true },
    });
  }

  async addMember(accountId: string, dto: AddMemberDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      throw new NotFoundException('No user with that email — they need an account on the platform first');
    }
    const role = await this.prisma.role.findUnique({ where: { key: dto.roleKey } });
    if (!role) {
      throw new BadRequestException(`Unknown role key "${dto.roleKey}"`);
    }
    return this.prisma.accountMember.upsert({
      where: { accountId_userId: { accountId, userId: user.id } },
      update: { roleId: role.id, status: 'active' },
      create: { accountId, userId: user.id, roleId: role.id },
    });
  }
}
