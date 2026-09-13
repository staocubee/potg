import { IsIn, IsOptional, IsString } from 'class-validator';

// The audit's own finding: "proposing a resolution is just a status
// flip + free-text note, no structured proposal object." resolutionType
// records what the resolution actually decided — it doesn't itself
// move money or trigger rework, those stay separate, existing actions
// (see Dispute.resolutionType's own schema comment).
export const RESOLUTION_TYPES = ['refund', 'release', 'rework', 'no_action', 'other'] as const;

export class ResolveDisputeDto {
  @IsIn(['resolved', 'rejected'])
  status!: 'resolved' | 'rejected';

  @IsOptional()
  @IsString()
  resolutionNotes?: string;

  @IsOptional()
  @IsIn(RESOLUTION_TYPES)
  resolutionType?: string;
}
