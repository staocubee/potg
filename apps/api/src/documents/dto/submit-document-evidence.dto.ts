import { IsOptional, IsString, IsUrl } from 'class-validator';

export class SubmitDocumentEvidenceDto {
  @IsString()
  note!: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  fileUrl?: string;
}
