import { IsOptional, IsString, IsUrl } from 'class-validator';

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
}
