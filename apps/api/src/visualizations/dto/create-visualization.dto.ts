import { IsIn, IsOptional, IsString, IsUrl } from 'class-validator';

const VISUALIZATION_KINDS = ['renovation', 'staging'] as const;

export class CreateVisualizationDto {
  // Same "URL you provide yourself" convention CreateDocumentDto.fileUrl
  // already uses — no upload pipeline exists in this scaffold.
  @IsUrl({ require_tld: false })
  beforeImageUrl!: string;

  @IsString()
  prompt!: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  // Module 23's "Virtual staging" — same before/prompt/after pipeline as
  // a renovation preview, just labeled and prompted differently on the
  // client. See RenovationVisualization's own schema comment.
  @IsOptional()
  @IsIn(VISUALIZATION_KINDS)
  kind?: (typeof VISUALIZATION_KINDS)[number];
}
