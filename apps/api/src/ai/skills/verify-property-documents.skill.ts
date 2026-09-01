import { NotFoundException } from '@nestjs/common';
import { AiSkill } from './ai-skill.interface';
import { NO_INPUT_SCHEMA } from './ai-skill-input-schema';
import { DEFAULT_DOCUMENT_CHECKLIST, labelDocumentType } from './document-checklists';

// The "verify" action from Module 2 / Module 6's AI Assistance sections:
// pre-checks uploaded documents against the checklist and flags what's
// missing — it never sets Document.verificationStatus itself, that stays a
// human/admin workflow (Module 6). This only drafts what a reviewer would
// otherwise have to work out by hand.
export const verifyPropertyDocumentsSkill: AiSkill = {
  key: 'verify_property_documents',
  label: 'Verify property documents',
  requiredPermission: 'document:read',
  moduleContextPrefix: 'property',
  inputSchema: NO_INPUT_SCHEMA,

  async run(ctx, moduleContext, _input, { prisma }) {
    const propertyId = moduleContext.split(':')[1];
    const property = await prisma.property.findFirst({
      where: { id: propertyId, accountId: ctx.accountId },
    });
    if (!property) throw new NotFoundException('Property not found');

    const documents = await prisma.document.findMany({ where: { propertyId } });
    const checklist = DEFAULT_DOCUMENT_CHECKLIST;

    const items = checklist.map((documentType) => {
      const found = documents.find(
        (d: { documentType: string; verificationStatus: string }) => d.documentType === documentType,
      );
      return found
        ? `${labelDocumentType(documentType)} — on file (${found.verificationStatus})`
        : `${labelDocumentType(documentType)} — missing`;
    });

    return {
      draftLabel: 'Document check — draft',
      items,
      warn: items.some((item) => item.endsWith('missing')),
    };
  },
};
