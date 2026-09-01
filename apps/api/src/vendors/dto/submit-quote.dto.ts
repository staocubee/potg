import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

// Used by a vendor account for both first-time submission and re-quoting —
// the service upserts on the (projectId, vendorId) pair so a vendor has at
// most one live quote per project, matching the "compare vendor quotes" AI
// skill's assumption that it's comparing one quote per vendor.
export class SubmitQuoteDto {
  @IsString()
  projectId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
