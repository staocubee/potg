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

  // Real remote-verification evidence for this specific finding — see
  // InspectionFinding.photoUrls's own schema comment. Populated with real
  // URLs from POST /uploads (Cloudflare R2), same "just a String[], this
  // app doesn't validate the URL shape" convention AddProjectUpdateDto.
  // mediaUrls already uses.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoUrls?: string[];
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

  // General walkthrough/overview photos for the inspection as a whole —
  // see PropertyInspection.photoUrls's own schema comment.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoUrls?: string[];
}
