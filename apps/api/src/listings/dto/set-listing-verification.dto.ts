import { IsIn, IsOptional, IsString } from 'class-validator';

// Matches PropertyListing.verificationStatus's own vocabulary exactly —
// not Vendor/Supplier's three-state one (not_verified | pending |
// verified). "submitted"/"rejected" were already real column values
// (the platform-admin verification backlog already counts "submitted"
// listings) with nothing that had ever written or read them back.
const VERIFICATION_STATUSES = ['not_verified', 'submitted', 'verified', 'rejected'] as const;

export class SetListingVerificationDto {
  @IsIn(VERIFICATION_STATUSES)
  status!: string;

  // What's needed to move off "submitted", or the reviewer's reason for
  // the final call — same shape SetVendorVerificationDto's own notes
  // field already uses.
  @IsOptional()
  @IsString()
  notes?: string;
}
