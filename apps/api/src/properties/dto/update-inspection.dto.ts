import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

const INSPECTION_TYPES = ['general', 'pre_purchase', 'move_in', 'move_out', 'safety', 'post_renovation'] as const;

export class UpdateInspectionDto {
  @IsOptional()
  @IsIn(INSPECTION_TYPES)
  inspectionType?: string;

  @IsOptional()
  @IsDateString()
  scheduledFor?: string;

  // Empty string clears the project link; undefined leaves it unchanged.
  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  inspectorName?: string;

  // Set instead of inspectorName when the inspector is a platform vendor —
  // PropertiesService clears whichever of the two isn't given.
  @IsOptional()
  @IsString()
  inspectorVendorId?: string;
}
