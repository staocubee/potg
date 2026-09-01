import { IsDateString, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class RecordRentPaymentDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @IsOptional()
  @IsString()
  method?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
