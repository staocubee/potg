import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

const DELIVERY_STATUSES = ['pending', 'in_transit', 'delivered', 'failed'] as const;

export class UpdateDeliveryDto {
  @IsIn(DELIVERY_STATUSES)
  status!: string;

  @IsOptional()
  @IsString()
  trackingReference?: string;

  @IsOptional()
  @IsDateString()
  estimatedDeliveryDate?: string;
}
