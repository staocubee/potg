import { IsIn, IsOptional, IsString } from 'class-validator';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export class ReportMaintenanceRequestDto {
  @IsString()
  title!: string;

  @IsString()
  description!: string;

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
