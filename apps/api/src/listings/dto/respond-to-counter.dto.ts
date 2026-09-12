import { IsIn } from 'class-validator';

const COUNTER_RESPONSES = ['accepted', 'rejected'] as const;

// The buyer's own half of a negotiation — deliberately narrower than
// RespondOfferDto (no "countered" here): a buyer accepts or walks away
// from the seller's counter in this pass, it doesn't re-counter again.
// See ListingsService.respondToCounter's own comment.
export class RespondToCounterDto {
  @IsIn(COUNTER_RESPONSES)
  status!: 'accepted' | 'rejected';
}
