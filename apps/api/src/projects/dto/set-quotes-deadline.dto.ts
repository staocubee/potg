import { IsDateString } from 'class-validator';

export class SetQuotesDeadlineDto {
  @IsDateString()
  deadline!: string;
}
