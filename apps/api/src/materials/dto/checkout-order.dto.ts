import { IsIn, IsOptional } from 'class-validator';

const PROVIDERS = ['manual', 'paystack', 'flutterwave', 'stripe', 'paypal'] as const;

// No client-supplied amount, unlike DepositDto — an order's own
// totalAmount is what's owed, not a value the buyer gets to pick.
export class CheckoutOrderDto {
  @IsOptional()
  @IsIn(PROVIDERS)
  provider?: (typeof PROVIDERS)[number];
}
