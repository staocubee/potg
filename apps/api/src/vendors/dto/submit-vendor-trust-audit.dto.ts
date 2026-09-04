import { IsIn, IsNotEmpty, IsString } from 'class-validator';

const AUDIT_RATINGS = ['clean', 'minor_concerns', 'major_concerns'] as const;

export class SubmitVendorTrustAuditDto {
  @IsIn(AUDIT_RATINGS)
  rating!: string;

  // Required, not optional — see VendorTrustAudit's own schema comment:
  // an audit with no reasoning recorded isn't an audit.
  @IsString()
  @IsNotEmpty()
  notes!: string;
}
