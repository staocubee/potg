import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

// Mirrors SubmitQuoteDto's own shape (projectId -> maintenanceRequestId) —
// see MaintenanceRequest.quotedAmount's own schema comment for why this is
// a flat upsert on the request itself rather than a VendorQuote row.
export class SubmitMaintenanceQuoteDto {
  @IsString()
  maintenanceRequestId!: string;

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
