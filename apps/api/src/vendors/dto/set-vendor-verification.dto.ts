import { IsIn, IsOptional, IsString } from 'class-validator';

const VERIFICATION_STATUSES = ['not_verified', 'pending', 'verified'] as const;

export class SetVendorVerificationDto {
  @IsIn(VERIFICATION_STATUSES)
  status!: string;

  // What's needed to move off "pending", or the reviewer's reason for
  // the final call — the note that gives "pending" the "awaiting
  // evidence" meaning it didn't have before (the status itself was
  // already settable; nothing gave it context or a paper trail).
  @IsOptional()
  @IsString()
  notes?: string;
}
