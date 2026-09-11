import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

const PROVIDERS = ['manual', 'paystack', 'flutterwave', 'stripe', 'paypal'] as const;

export class SubscribePackageDto {
  @IsString()
  packageId!: string;

  @IsOptional()
  @IsIn(PROVIDERS)
  provider?: string;

  // Only ever honored for provider "paystack" — see
  // PackagesService.subscribe's own validation, and PaystackService's own
  // real chargeAuthorization for what "auto-renew" actually does.
  @IsOptional()
  @IsBoolean()
  autoRenew?: boolean;
}
