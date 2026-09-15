import { IsOptional, IsString } from 'class-validator';

export class PayRentScheduleEntryDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
