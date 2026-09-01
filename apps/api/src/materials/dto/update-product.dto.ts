import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

const PRODUCT_STATUSES = ['active', 'out_of_stock', 'discontinued'] as const;

export class UpdateProductDto {
  @IsOptional()
  @IsNumber()
  @IsPositive()
  unitPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stockQuantity?: number;

  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isRentable?: boolean;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  rentalPricePerDay?: number;
}
