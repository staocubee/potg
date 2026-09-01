import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentVerificationDto } from './dto/update-document-verification.dto';

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

  // The other half of verify_property_documents (src/ai/skills) — that
  // skill only ever drafts a checklist against Document.verificationStatus,
  // it never sets it. This is the "human/admin workflow" its own comment
  // says stays separate. Not nested under :propertyId/:projectId, so it
  // can't lean on PermissionsGuard's ABAC convention — filters by accountId
  // directly instead, same shape as PaymentsService.getAccountOverview.
  //
  // There's no neutral third-party reviewer role in this scaffold's RBAC
  // (Section 8's account_manage roles are the only ones granted
  // document:verify) — an account's own owner/admin can verify a document
  // its own member uploaded. A real deployment implementing Module 6's
  // "neutral reviewer" would need a reviewer identity outside the
  // uploading account entirely; that's still open, see the README.
  async verify(documentId: string, accountId: string, dto: UpdateDocumentVerificationDto) {
    const document = await this.prisma.document.findFirst({ where: { id: documentId, accountId } });
    if (!document) throw new NotFoundException('Document not found');

    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: { verificationStatus: dto.status, verificationNotes: dto.notes ?? null },
    });

    if (document.propertyId) {
      await this.prisma.propertyTimelineEvent.create({
        data: {
          propertyId: document.propertyId,
          eventType: dto.status === 'verified' ? 'document_verified' : 'document_rejected',
          label: `Document ${dto.status}: ${document.documentType}${dto.notes ? ` — ${dto.notes}` : ''}`,
        },
      });
    }

    return updated;
  }
}
