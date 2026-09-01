import { IsDateString, IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateDocumentDto {
  @IsString()
  documentType!: string; // e.g. "title_document", "survey_plan", "certificate_of_occupancy"

  @IsUrl({ require_tld: false })
  fileUrl!: string;

  @IsOptional()
  @IsString()
  propertyId?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}
