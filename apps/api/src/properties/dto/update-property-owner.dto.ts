import { IsDateString, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdatePropertyOwnerDto {
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100)
  ownershipPercentage?: number;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
