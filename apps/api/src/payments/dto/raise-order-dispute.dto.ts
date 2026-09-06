import { IsIn, IsString } from 'class-validator';
import { DISPUTE_TYPES } from './raise-dispute.dto';

// Module 18 Phase 1's order-dispute counterpart to RaiseDisputeDto — no
// milestoneId/paymentId/payoutId (those are project-escrow-specific,
// Order has no equivalent), orderId comes from the route rather than the
// body, same shape RaiseDisputeAsVendorDto's own projectId comment gives
// for why a project/order id sometimes lives in the body and sometimes
// in the URL.
export class RaiseOrderDisputeDto {
  @IsIn(DISPUTE_TYPES)
  disputeType!: string;

  @IsString()
  reason!: string;
}
