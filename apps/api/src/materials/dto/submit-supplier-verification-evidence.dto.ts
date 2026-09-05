import { IsOptional, IsString, IsUrl } from 'class-validator';

export class SubmitSupplierVerificationEvidenceDto {
  @IsString()
  note!: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  fileUrl?: string;
}
