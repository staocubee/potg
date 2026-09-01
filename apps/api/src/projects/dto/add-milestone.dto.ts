import { IsDateString, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class AddMilestoneDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  paymentAmount?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
