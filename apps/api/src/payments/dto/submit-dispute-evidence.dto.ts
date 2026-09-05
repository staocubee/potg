import { IsOptional, IsString, IsUrl } from 'class-validator';

export class SubmitDisputeEvidenceDto {
  @IsString()
  note!: string;

  // A URL — either pasted (something already hosted elsewhere) or one
  // returned by POST /uploads (the general upload pipeline, this pass),
  // same as CreateDocumentDto.fileUrl.
  @IsOptional()
  @IsUrl({ require_tld: false })
  fileUrl?: string;
}
