import { IsDateString, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateRentalBookingDto {
  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  quantity?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
