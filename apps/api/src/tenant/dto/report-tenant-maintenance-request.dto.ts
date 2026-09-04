import { IsIn, IsOptional, IsString } from 'class-validator';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

// The tenant-facing counterpart to ReportMaintenanceRequestDto — no
// propertyId/leaseId/assignedTo/assignedVendorId, since TenantService
// fills all of that in from the caller's own linked lease. A tenant
// reports what's wrong; who it gets assigned to is the landlord's call.
export class ReportTenantMaintenanceRequestDto {
  @IsString()
  title!: string;

  @IsString()
  description!: string;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: string;
}
