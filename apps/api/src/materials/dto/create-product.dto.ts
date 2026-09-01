import { IsBoolean, IsInt, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';

export class CreateProductDto {
  @IsString()
  name!: string;

  @IsString()
  category!: string;

  @IsString()
  unit!: string;

  @IsNumber()
  @IsPositive()
  unitPrice!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  stockQuantity?: number;

  @IsOptional()
  @IsString()
  description?: string;

  // Module 10's rental flag — a product is either sold or rentable by the
  // day, see Product.isRentable's own comment in schema.prisma.
  @IsOptional()
  @IsBoolean()
  isRentable?: boolean;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  rentalPricePerDay?: number;
}
