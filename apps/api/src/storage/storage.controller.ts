import { BadRequestException, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AccountContextGuard } from '../common/guards/account-context.guard';
import { CurrentAccountMember } from '../common/decorators/current-user.decorator';
import { StorageService } from './storage.service';

type AccountMemberCtx = { accountId: string };

// Security fix: this route previously accepted any content-type at all —
// a real risk since the resulting URL gets attached wherever a fileUrl
// field already exists (documents, dispute evidence, vendor/supplier
// verification), all served back from a public R2 bucket. An uploaded
// text/html or image/svg+xml file is itself active content once served
// back with its own content-type intact (StorageService.upload passes the
// client-supplied contentType straight through to R2) — a real stored-
// content hosting risk, not just an oversized-file one. Images and
// documents only; nothing here is meant to ever be executable/renderable
// as a page in its own right.
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

// The general file-upload pipeline the README used to flag as missing —
// before this, StorageService (Cloudflare R2) was wired only into the
// one narrow AI-visualization path, and every other "file" in this
// scaffold (Document.fileUrl, DisputeEvidence.fileUrl, the new
// Document/Vendor/SupplierVerificationEvidence.fileUrl) meant pasting a
// URL to something already hosted elsewhere. This one route replaces
// that everywhere: upload real bytes here, get back a real URL, then use
// that URL wherever a fileUrl field already existed — no schema change
// needed on any of them.
//
// Deliberately no @RequirePermissions/PermissionsGuard here — uploading
// bytes to storage isn't itself the sensitive action; what matters is
// which permission gates whatever attaches the resulting URL to a real
// resource afterward (document:write, dispute:write, vendor:write, ...).
// Just JwtAuthGuard + AccountContextGuard: any authenticated member of
// any account can obtain a URL, same as any of them could always paste
// one of their own choosing into the very same fields.
@UseGuards(JwtAuthGuard, AccountContextGuard)
@Controller('uploads')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async upload(@UploadedFile() file: Express.Multer.File, @CurrentAccountMember() member: AccountMemberCtx) {
    if (!file) throw new BadRequestException('No file provided — send it as multipart/form-data field "file"');
    if (!ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(`"${file.mimetype}" isn't an accepted file type — upload an image, PDF, or Word/Excel document`);
    }
    const url = await this.storage.upload(file.buffer, file.mimetype, `uploads/${member.accountId}`, file.originalname);
    return { url };
  }
}
