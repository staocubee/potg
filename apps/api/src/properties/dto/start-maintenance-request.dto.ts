import { IsOptional, IsString } from 'class-validator';

export class StartMaintenanceRequestDto {
  @IsOptional()
  @IsString()
  assignedTo?: string;

  // Set instead of assignedTo when the assignee is a platform vendor —
  // PropertiesService clears whichever of the two isn't given.
  @IsOptional()
  @IsString()
  assignedVendorId?: string;
}
