import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateVendorReviewDto {
  @IsString()
  vendorId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  comment?: string;
}
