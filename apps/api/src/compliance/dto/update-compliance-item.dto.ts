import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

const STATUSES = ['not_started', 'in_progress', 'done'] as const;

export class UpdateComplianceItemDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  jurisdiction?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  category?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @IsOptional()
  @IsString()
  notes?: string;
}
