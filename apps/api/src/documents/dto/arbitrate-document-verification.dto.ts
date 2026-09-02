import { IsIn, IsOptional, IsString } from 'class-validator';

// The neutral-reviewer counterpart to UpdateDocumentVerificationDto — a
// superset, not a variant: everything the account's own self-verify can
// do (verified/rejected), plus "submitted", the arbitrator-only "not
// enough here yet, send it back for more evidence" status neither the
// uploading account nor its own admin can set on itself. Same shape as
// ArbitrateDisputeDto adding "under_review" to ResolveDisputeDto —
// Document.verificationStatus's own comment already anticipated
// "submitted" (not_verified | submitted | verified | rejected); nothing
// ever wrote it until this DTO existed.
export class ArbitrateDocumentVerificationDto {
  @IsIn(['verified', 'rejected', 'submitted'])
  status!: 'verified' | 'rejected' | 'submitted';

  @IsOptional()
  @IsString()
  notes?: string;
}
