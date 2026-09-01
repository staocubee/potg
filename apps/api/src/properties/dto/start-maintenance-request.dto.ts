import { IsOptional, IsString } from 'class-validator';

export class StartMaintenanceRequestDto {
  @IsOptional()
  @IsString()
  assignedTo?: string;
}
