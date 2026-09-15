import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

const INSPECTION_TYPES = ['general', 'pre_purchase', 'move_in', 'move_out', 'safety', 'post_renovation'] as const;

export class ScheduleInspectionDto {
  @IsIn(INSPECTION_TYPES)
  inspectionType!: string;

  @IsDateString()
  scheduledFor!: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  // The audit's own finding on Workflows 3 & 4: real per-stage
  // gating/advancing needs a real link to which stage this inspection is
  // actually for — see PropertyInspection.stageId's own schema comment.
  // Only meaningful alongside projectId; PropertiesService validates the
  // stage actually belongs to that same project.
  @IsOptional()
  @IsString()
  stageId?: string;

  @IsOptional()
  @IsString()
  inspectorName?: string;

  // Set instead of inspectorName when the inspector is a platform vendor —
  // PropertiesService clears whichever of the two isn't given.
  @IsOptional()
  @IsString()
  inspectorVendorId?: string;
}
