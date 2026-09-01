import { IsIn, IsOptional, IsString } from 'class-validator';

export class ResolveDisputeDto {
  @IsIn(['resolved', 'rejected'])
  status!: 'resolved' | 'rejected';

  @IsOptional()
  @IsString()
  resolutionNotes?: string;
}
