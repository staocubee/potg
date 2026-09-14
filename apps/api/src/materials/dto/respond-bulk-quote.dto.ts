import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class RespondBulkQuoteDto {
  @IsNumber()
  @IsPositive()
  unitPrice!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
