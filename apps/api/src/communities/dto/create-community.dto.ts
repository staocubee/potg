import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

const COMMUNITY_TYPES = ['estate', 'apartment_building', 'gated_community'] as const;

export class CreateCommunityDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  addressLine!: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsString()
  @MinLength(1)
  country!: string;

  @IsIn(COMMUNITY_TYPES)
  communityType!: string;
}
