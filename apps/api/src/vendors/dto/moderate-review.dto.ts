import { IsIn, IsOptional, IsString } from 'class-validator';

export class ModerateReviewDto {
  @IsIn(['hidden', 'published'])
  status!: 'hidden' | 'published';

  @IsOptional()
  @IsString()
  moderationNotes?: string;
}
