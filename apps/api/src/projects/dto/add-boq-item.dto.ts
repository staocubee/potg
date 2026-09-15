import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class AddBoqItemDto {
  @IsString()
  description!: string;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  estimatedUnitCost?: number;
}
