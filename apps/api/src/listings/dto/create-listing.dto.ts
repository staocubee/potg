import { IsArray, IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUrl } from 'class-validator';

const LISTING_TYPES = ['sale', 'rent', 'short_let'] as const;

export class CreateListingDto {
  @IsString()
  propertyId!: string;

  @IsIn(LISTING_TYPES)
  listingType!: string;

  @IsNumber()
  @IsPositive()
  askingPrice!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsUrl({ require_tld: false }, { each: true })
  photoUrls?: string[];
}
