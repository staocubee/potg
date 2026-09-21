import { IsUrl, IsString } from 'class-validator';

// imageUrl is expected to already be a real uploaded file's URL (the
// admin UI uploads via POST /uploads first, same as every other photo
// field in this codebase, then sends the resulting URL here) — this
// endpoint itself never accepts a raw file.
export class SetDefaultThumbnailDto {
  @IsString()
  @IsUrl({ require_tld: false })
  imageUrl!: string;
}
