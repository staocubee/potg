import { IsOptional, IsString } from 'class-validator';

export class RaiseDisputeDto {
  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  milestoneId?: string;

  @IsOptional()
  @IsString()
  paymentId?: string;

  @IsOptional()
  @IsString()
  payoutId?: string;
}
