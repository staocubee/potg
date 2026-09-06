import { IsIn, IsOptional, IsString } from 'class-validator';

// Module 18's own "Dispute Types" list — required on every new dispute
// (project or order); existing rows created before this pass default to
// "other" at the schema level, not required to backfill.
export const DISPUTE_TYPES = [
  'poor_workmanship',
  'delayed_project',
  'material_delivery_issue',
  'payment_disagreement',
  'property_listing_dispute',
  'tenant_complaint',
  'vendor_misconduct',
  'refund_request',
  'other',
] as const;

export class RaiseDisputeDto {
  @IsIn(DISPUTE_TYPES)
  disputeType!: string;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  milestoneId?: string;

  @IsOptional()
  @IsString()
  paymentId?: string;

  @IsOptional()
  @IsString()
  payoutId?: string;
}
