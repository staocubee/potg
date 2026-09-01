import { IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

const RENT_FREQUENCIES = ['weekly', 'monthly', 'annually'] as const;

export class UpdateLeaseDto {
  @IsOptional()
  @IsString()
  tenantName?: string;

  @IsOptional()
  @IsString()
  tenantEmail?: string;

  @IsOptional()
  @IsString()
  tenantPhone?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  rentAmount?: number;

  @IsOptional()
  @IsIn(RENT_FREQUENCIES)
  rentFrequency?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  depositAmount?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  // Empty string clears an existing endDate; undefined leaves it unchanged.
  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
