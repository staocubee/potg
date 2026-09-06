import { IsIn, IsInt, IsOptional, IsString, IsUrl } from 'class-validator';

const MEDIA_TYPES = ['photo_360', 'video_360'] as const;

// Module 23's "store media metadata in a way that supports 360 content
// and virtual tour assets" — same "URL you provide yourself" convention
// Document.fileUrl already uses, since no upload pipeline exists here.
export class CreateTourAssetDto {
  @IsUrl({ require_tld: false })
  mediaUrl!: string;

  @IsOptional()
  @IsIn(MEDIA_TYPES)
  mediaType?: (typeof MEDIA_TYPES)[number];

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
