import { IsIn, IsOptional, IsString } from 'class-validator';

export class SetMaintenanceApprovalDto {
  @IsIn(['approved', 'rejected'])
  status!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  notes?: string;
}
