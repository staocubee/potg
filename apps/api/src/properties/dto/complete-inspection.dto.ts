import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

const SEVERITIES = ['minor', 'moderate', 'major'] as const;
const RESULTS = ['pass', 'needs_attention', 'fail'] as const;

class InspectionFindingInput {
  @IsString()
  area!: string;

  @IsString()
  description!: string;

  @IsOptional()
  @IsIn(SEVERITIES)
  severity?: string;
}

export class CompleteInspectionDto {
  @IsIn(RESULTS)
  overallResult!: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InspectionFindingInput)
  findings?: InspectionFindingInput[];
}
