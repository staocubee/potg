import { IsIn, IsOptional, IsString } from 'class-validator';

export class SetOrderApprovalDto {
  @IsIn(['approved', 'rejected'])
  status!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  notes?: string;
}
