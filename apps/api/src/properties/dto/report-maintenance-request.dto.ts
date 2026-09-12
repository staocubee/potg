import { IsIn, IsOptional, IsString } from 'class-validator';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

// The audit's own finding: no taxonomy existed at all — see
// MaintenanceRequest.category's own schema comment for the full list
// and why it's a flat category, not a sub-category/licensing system.
const CATEGORIES = [
  'plumbing',
  'electrical',
  'hvac',
  'appliance',
  'structural',
  'pest_control',
  'landscaping',
  'painting',
  'roofing',
  'cleaning',
  'general',
  'other',
] as const;

export class ReportMaintenanceRequestDto {
  @IsString()
  title!: string;

  @IsString()
  description!: string;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: string;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: string;

  @IsOptional()
  @IsString()
  leaseId?: string;

  @IsOptional()
  @IsString()
  reportedBy?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  // Set instead of assignedTo when the assignee is a platform vendor —
  // PropertiesService clears whichever of the two isn't given.
  @IsOptional()
  @IsString()
  assignedVendorId?: string;
}
