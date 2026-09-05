import { IsOptional, IsString, IsUrl } from 'class-validator';

export class SubmitVendorVerificationEvidenceDto {
  @IsString()
  note!: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  fileUrl?: string;
}
