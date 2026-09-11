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

  // Module 3: Property Details — see the schema's own comment on these
  // fields for why they exist and why every one is optional.
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

  // Module 24's Branch feature — optional, same reasoning every field
  // here is: a property is real and useful long before its owner has
  // organized it into a branch.
  @IsOptional()
  @IsString()
  branchId?: string;
}
