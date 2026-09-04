import { IsDateString, IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateDocumentDto {
  @IsString()
  documentType!: string; // e.g. "title_document", "survey_plan", "certificate_of_occupancy"

  @IsUrl({ require_tld: false })
  fileUrl!: string;

  @IsOptional()
  @IsString()
  propertyId?: string;

  // Tags this document as belonging to a specific tenancy — see the
  // schema comment on Document.leaseId. Must belong to propertyId if
  // both are given (DocumentsService.create cross-checks, or derives
  // propertyId from the lease if only this is given).
  @IsOptional()
  @IsString()
  leaseId?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}
