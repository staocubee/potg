import { IsIn, IsOptional, IsString } from 'class-validator';
import { RESOLUTION_TYPES } from './resolve-dispute.dto';

const PROPOSAL_RESPONSES = ['accepted', 'rejected', 'countered'] as const;

// The other party's own half of a proposal — deliberately not capped
// at accept/reject the way the marketplace's own RespondToCounterDto
// is (see that DTO's own comment: "a buyer accepts or walks away... it
// doesn't re-counter again"). A dispute counter-response can re-counter
// indefinitely — PaymentsService.respondToResolutionProposal creates a
// new DisputeResolutionProposal row each time rather than mutating one
// in place, so there's no structural reason to cap the loop the way a
// single mutable ListingOffer.amount field would have needed to.
// resolutionType/resolutionNotes are only read when action is
// "countered" — validated in the service, not here, same "cross-field
// validation lives in the service" convention RecordRentPaymentDto's
// own scheduleEntryId already follows.
export class RespondToResolutionProposalDto {
  @IsIn(PROPOSAL_RESPONSES)
  action!: 'accepted' | 'rejected' | 'countered';

  @IsOptional()
  @IsIn(RESOLUTION_TYPES)
  resolutionType?: string;

  @IsOptional()
  @IsString()
  resolutionNotes?: string;
}
