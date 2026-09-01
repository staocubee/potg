import { IsIn, IsOptional, IsString } from 'class-validator';

export class EndLeaseDto {
  @IsIn(['ended', 'terminated'])
  status!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
