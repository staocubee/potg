import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDocumentDto } from './dto/create-document.dto';

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(accountId: string, uploadedByUserId: string, dto: CreateDocumentDto) {
    const document = await this.prisma.document.create({
      data: {
        accountId,
        uploadedByUserId,
        documentType: dto.documentType,
        fileUrl: dto.fileUrl,
        propertyId: dto.propertyId,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
      },
    });
    if (dto.propertyId) {
      await this.prisma.propertyTimelineEvent.create({
        data: {
          propertyId: dto.propertyId,
          eventType: 'document_uploaded',
          label: `Document uploaded: ${dto.documentType}`,
        },
      });
    }
    return document;
  }

  findForProperty(propertyId: string) {
    return this.prisma.document.findMany({
      where: { propertyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findForAccount(accountId: string) {
    return this.prisma.document.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
