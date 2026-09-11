import { IsIn, IsOptional, IsString } from 'class-validator';

const PROVIDERS = ['manual', 'paystack', 'flutterwave', 'stripe', 'paypal'] as const;

export class SubscribePackageDto {
  @IsString()
  packageId!: string;

  @IsOptional()
  @IsIn(PROVIDERS)
  provider?: string;
}
