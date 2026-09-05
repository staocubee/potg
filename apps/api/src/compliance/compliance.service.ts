import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateComplianceItemDto } from './dto/create-compliance-item.dto';
import { UpdateComplianceItemDto } from './dto/update-compliance-item.dto';

// The "Payment/escrow licensing, market-specific verification mechanisms,
// and data residency" gap — not the compliance work itself (nothing here
// grants a license, verifies a jurisdiction's requirements, or enforces
// data residency), just a checklist the platform's own trust & safety
// function uses to track that work exists and where it stands. Fully
// platform-wide, like RolesService would be if one existed — every
// method here reaches every row, no accountId anywhere, same as
// Role/Permission themselves.
@Injectable()
export class ComplianceService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.complianceItem.findMany({ orderBy: [{ jurisdiction: 'asc' }, { category: 'asc' }] });
  }

  create(dto: CreateComplianceItemDto) {
    return this.prisma.complianceItem.create({
      data: { jurisdiction: dto.jurisdiction, category: dto.category, title: dto.title, notes: dto.notes },
    });
  }

  private async requireItem(id: string) {
    const item = await this.prisma.complianceItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Compliance item not found');
    return item;
  }

  async update(id: string, dto: UpdateComplianceItemDto) {
    await this.requireItem(id);
    return this.prisma.complianceItem.update({ where: { id }, data: dto });
  }

  async delete(id: string) {
    await this.requireItem(id);
    await this.prisma.complianceItem.delete({ where: { id } });
    return { deleted: true };
  }
}
