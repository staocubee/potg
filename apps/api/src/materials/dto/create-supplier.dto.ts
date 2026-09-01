import { IsIn, IsOptional, IsString } from 'class-validator';

const SUPPLIER_CATEGORIES = ['materials', 'tools', 'equipment'] as const;

export class CreateSupplierDto {
  @IsString()
  businessName!: string;

  @IsIn(SUPPLIER_CATEGORIES)
  category!: string;

  @IsOptional()
  @IsString()
  locationCoverage?: string;
}
