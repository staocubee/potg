import { IsDateString } from 'class-validator';

export class RequestInspectionDto {
  @IsDateString()
  preferredDate!: string;
}
