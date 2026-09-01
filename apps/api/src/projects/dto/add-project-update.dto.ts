import { IsArray, IsOptional, IsString } from 'class-validator';

export class AddProjectUpdateDto {
  @IsString()
  description!: string;

  @IsOptional()
  @IsString()
  milestoneId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaUrls?: string[];
}
