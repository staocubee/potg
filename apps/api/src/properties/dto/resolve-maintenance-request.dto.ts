import { IsArray, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

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

  // The audit's own finding: resolution recorded only free-text notes
  // and a cost number — real completion/receipt photos, closing that.
  // See MaintenanceRequest.resolutionPhotoUrls's own schema comment for
  // why this is a separate field from the report-time photoUrls.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  resolutionPhotoUrls?: string[];
}
