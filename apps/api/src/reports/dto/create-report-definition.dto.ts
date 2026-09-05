import { ArrayMinSize, IsArray, IsString, MinLength } from 'class-validator';

export class CreateReportDefinitionDto {
  @IsString()
  @MinLength(1)
  name!: string;

  // Validated against METRIC_REGISTRY in ReportsService, not here — this
  // just checks the shape, not which keys are real.
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  metrics!: string[];
}
