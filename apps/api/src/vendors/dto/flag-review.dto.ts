import { IsString } from 'class-validator';

export class FlagReviewDto {
  @IsString()
  reason!: string;
}
