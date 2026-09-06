import { IsArray, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Min } from 'class-validator';

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

// The base Property record had no update endpoint at all before Module
// 3 — only nested resources (valuations, inspections, leases,
// maintenance) could be edited after creation. Every field here is
// optional, same shape UpdateLeaseDto already uses; a caller sends only
// what actually changed.
export class UpdatePropertyDto {
  @IsOptional()
  @IsIn(PROPERTY_TYPES)
  propertyType?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  addressLine?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  country?: string;

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

  @IsOptional()
  @IsInt()
  @Min(0)
  bedrooms?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bathrooms?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  squareFootage?: number;

  @IsOptional()
  @IsInt()
  @Min(1800)
  yearBuilt?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoUrls?: string[];
}
