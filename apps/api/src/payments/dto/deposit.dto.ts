import { IsIn, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

const PROVIDERS = ['manual', 'paystack', 'flutterwave', 'stripe', 'paypal'] as const;

// A simulated deposit — see the schema comment on Payment for why. No
// gateway is actually called; this endpoint just records the deposit and
// moves the escrow ledger as if one had succeeded.
export class DepositDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsIn(PROVIDERS)
  provider?: string;

  @IsOptional()
  @IsString()
  providerReference?: string;
}
