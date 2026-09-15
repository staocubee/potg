import { IsIn, IsOptional, IsString } from 'class-validator';
import { RESOLUTION_TYPES } from './resolve-dispute.dto';

// The audit's own finding: "proposing a resolution is just a status
// flip + free-text note, no structured proposal object." This is that
// real object — unlike ResolveDisputeDto, resolutionType is required
// here (not optional): a proposal that doesn't name a real outcome
// isn't a proposal the other side can meaningfully accept, reject, or
// counter.
export class ProposeResolutionDto {
  @IsIn(RESOLUTION_TYPES)
  resolutionType!: string;

  @IsOptional()
  @IsString()
  resolutionNotes?: string;
}
