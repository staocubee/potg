import { IsIn, IsOptional, IsString } from 'class-validator';

// The neutral-reviewer counterpart to ResolveDisputeDto — a superset, not
// a variant: everything a two-party resolution can do (resolved/rejected),
// plus "under_review", the arbitrator-only "I've seen this, I need more
// evidence before I can decide" status neither party can set on itself.
// The Dispute schema's own status comment already anticipated
// "under_review"; nothing ever wrote it until this DTO existed.
export class ArbitrateDisputeDto {
  @IsIn(['resolved', 'rejected', 'under_review'])
  status!: 'resolved' | 'rejected' | 'under_review';

  @IsOptional()
  @IsString()
  resolutionNotes?: string;
}
