import { IsOptional, IsString, IsUrl } from 'class-validator';

export class SubmitDisputeEvidenceDto {
  @IsString()
  note!: string;

  // Same "URL you provide yourself" shape as CreateDocumentDto.fileUrl —
  // no file upload/object storage in this scaffold, see the README.
  @IsOptional()
  @IsUrl({ require_tld: false })
  fileUrl?: string;
}
