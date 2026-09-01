import { IsString } from 'class-validator';

export class ReplyToReviewDto {
  @IsString()
  response!: string;
}
