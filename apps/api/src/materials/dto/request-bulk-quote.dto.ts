import { IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class RequestBulkQuoteDto {
  @IsInt()
  @IsPositive()
  quantity!: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  projectId?: string;
}
