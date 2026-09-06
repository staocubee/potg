import { IsString, MinLength } from 'class-validator';

// Required, not optional — same "an audit with no reasoning recorded
// isn't an audit" reasoning VendorTrustAudit.notes already establishes:
// a suspension with no recorded reason isn't accountable to anyone.
export class SuspendAccountDto {
  @IsString()
  @MinLength(1)
  reason!: string;
}
