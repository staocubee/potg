import { IsIn, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString } from 'class-validator';

const PROPERTY_TYPES = [
  'land',
  'residential_house',
  'apartment',
  'short_let',
  'commercial_building',
  'office',
  'shop',
  'warehouse',
  'estate',
  'farm',
  'industrial',
  'mixed_use',
] as const;

export class CreatePropertyDto {
  @IsIn(PROPERTY_TYPES)
  propertyType!: string;

  @IsString()
  name!: string;

  @IsString()
  addressLine!: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsString()
  country!: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsString()
  currentUse?: string;

  @IsOptional()
  @IsNumber()
  estimatedValue?: number;
}
