import { IsOptional, IsString } from 'class-validator';

export class ResolveMaintenanceRequestDto {
  @IsOptional()
  @IsString()
  resolutionNotes?: string;
}
