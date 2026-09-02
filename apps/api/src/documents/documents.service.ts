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
  // An account's own owner/admin can verify a document its own member
  // uploaded — not neutral, but see arbitrateVerify below for the actual
  // neutral-reviewer path Module 6 calls for.
  async verify(documentId: string, accountId: string, dto: UpdateDocumentVerificationDto) {
    const document = await this.prisma.document.findFirst({ where: { id: documentId, accountId } });
    if (!document) throw new NotFoundException('Document not found');
    return this.applyVerification(document, dto);
  }

  // Module 6's actual neutral-reviewer path for documents, the counterpart
  // to VendorsService.setVerificationStatus / PaymentsService.
  // arbitrateDispute. Gated on document:arbitrate, which only the
  // platform_reviewer role carries (never document:write, so it never
  // uploads — let alone owns — a document it might later arbitrate).
  // Looks the document up by id alone, no accountId filter, so it reaches
  // any document on the platform once the caller's role has the
  // permission — same shape the other two neutral-reviewer routes use.
  findPendingForArbitration() {
    return this.prisma.document.findMany({
      where: { verificationStatus: { notIn: ['verified', 'rejected'] } },
      include: {
        account: { select: { id: true, name: true } },
        property: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async arbitrateVerify(documentId: string, dto: UpdateDocumentVerificationDto) {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document) throw new NotFoundException('Document not found');
    return this.applyVerification(document, dto);
  }

  private async applyVerification(
    document: { id: string; documentType: string; propertyId: string | null },
    dto: UpdateDocumentVerificationDto,
  ) {
    const updated = await this.prisma.document.update({
      where: { id: document.id },
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
