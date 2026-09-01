import { IsIn, IsOptional, IsString } from 'class-validator';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export class UpdateMaintenanceRequestDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: string;
}
