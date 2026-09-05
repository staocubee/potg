import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CurrentAccountMember, CurrentUser } from '../common/decorators/current-user.decorator';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentVerificationDto } from './dto/update-document-verification.dto';
import { ArbitrateDocumentVerificationDto } from './dto/arbitrate-document-verification.dto';
import { SubmitDocumentEvidenceDto } from './dto/submit-document-evidence.dto';

type AccountMemberCtx = { accountId: string };
type UserCtx = { id: string };

@UseGuards(JwtAuthGuard, AccountContextGuard, PermissionsGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @RequirePermissions('document:write')
  @Post()
  create(
    @CurrentAccountMember() member: AccountMemberCtx,
    @CurrentUser() user: UserCtx,
    @Body() dto: CreateDocumentDto,
  ) {
    return this.documents.create(member.accountId, user.id, dto);
  }

  @RequirePermissions('document:read')
  @Get()
  findAll(@CurrentAccountMember() member: AccountMemberCtx) {
    return this.documents.findForAccount(member.accountId);
  }

  // Nested under /documents/property/:propertyId (rather than
  // /properties/:propertyId/documents) so PropertiesModule and
  // DocumentsModule stay independent of each other; PermissionsGuard's
  // ABAC check keys on the :propertyId param regardless of which
  // controller it appears on.
  @RequirePermissions('document:read')
  @Get('property/:propertyId')
  findForProperty(@Param('propertyId') propertyId: string) {
    return this.documents.findForProperty(propertyId);
  }

  @RequirePermissions('document:verify')
  @Patch(':documentId/verify')
  verify(
    @Param('documentId') documentId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @Body() dto: UpdateDocumentVerificationDto,
  ) {
    return this.documents.verify(documentId, member.accountId, dto);
  }

  // The structured "submit more evidence" channel — see
  // DocumentsService.submitEvidence's own comment. document:write, the
  // same gate creating the document itself uses — this is the document's
  // own owning account responding, not a neutral action.
  @RequirePermissions('document:write')
  @Post(':documentId/evidence')
  submitEvidence(
    @Param('documentId') documentId: string,
    @CurrentAccountMember() member: AccountMemberCtx,
    @CurrentUser() user: UserCtx,
    @Body() dto: SubmitDocumentEvidenceDto,
  ) {
    return this.documents.submitEvidence(documentId, member.accountId, user.id, dto);
  }

  @RequirePermissions('document:read')
  @Get(':documentId/evidence')
  findEvidence(@Param('documentId') documentId: string, @CurrentAccountMember() member: AccountMemberCtx) {
    return this.documents.findEvidence(documentId, member.accountId);
  }

  // Module 6's neutral-reviewer path — see
  // DocumentsService.findPendingForArbitration/arbitrateVerify.
  @RequirePermissions('document:arbitrate')
  @Get('pending')
  findPendingForArbitration() {
    return this.documents.findPendingForArbitration();
  }

  @RequirePermissions('document:arbitrate')
  @Patch(':documentId/arbitrate')
  arbitrateVerify(@Param('documentId') documentId: string, @Body() dto: ArbitrateDocumentVerificationDto) {
    return this.documents.arbitrateVerify(documentId, dto);
  }
}
