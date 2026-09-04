import { IsIn, IsNotEmpty, IsString } from 'class-validator';

const AUDIT_RATINGS = ['clean', 'minor_concerns', 'major_concerns'] as const;

export class SubmitSupplierTrustAuditDto {
  @IsIn(AUDIT_RATINGS)
  rating!: string;

  @IsString()
  @IsNotEmpty()
  notes!: string;
}
