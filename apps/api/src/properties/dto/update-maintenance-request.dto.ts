import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

const CATEGORIES = [
  'plumbing',
  'electrical',
  'hvac',
  'appliance',
  'structural',
  'pest_control',
  'landscaping',
  'painting',
  'roofing',
  'cleaning',
  'general',
  'other',
] as const;

export class UpdateMaintenanceRequestDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: string;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoUrls?: string[];
}
