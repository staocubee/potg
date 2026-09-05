import { IsIn, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

const VALUATION_SOURCES = ['manual', 'ai_estimate', 'comparable_sales'] as const;

export class CreateValuationDto {
  @IsNumber()
  @IsPositive()
  estimatedValue!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsIn(VALUATION_SOURCES)
  source?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
