import { IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

const RENT_FREQUENCIES = ['weekly', 'monthly', 'annually'] as const;

export class CreateLeaseDto {
  @IsString()
  tenantName!: string;

  @IsOptional()
  @IsString()
  tenantEmail?: string;

  @IsOptional()
  @IsString()
  tenantPhone?: string;

  @IsNumber()
  @IsPositive()
  rentAmount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsIn(RENT_FREQUENCIES)
  rentFrequency!: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  depositAmount?: number;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
