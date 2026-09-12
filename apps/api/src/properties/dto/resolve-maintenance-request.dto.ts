import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class ResolveMaintenanceRequestDto {
  @IsOptional()
  @IsString()
  resolutionNotes?: string;

  // Module 24's "Maintenance report" (cost) — optional, since not every
  // resolution has (or needs) a recorded cost, e.g. a false alarm or
  // something the owner fixed themselves for free.
  @IsOptional()
  @IsNumber()
  @IsPositive()
  cost?: number;
}
