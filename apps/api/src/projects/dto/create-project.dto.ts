import { IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

const PROJECT_TYPES = ['renovation', 'new_build', 'maintenance', 'landscaping', 'interior_design'] as const;

export class CreateProjectDto {
  @IsString()
  propertyId!: string;

  @IsIn(PROJECT_TYPES)
  projectType!: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  scopeDescription?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  budget?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  expectedEndDate?: string;
}
