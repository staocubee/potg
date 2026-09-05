import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateComplianceItemDto {
  @IsString()
  @MinLength(1)
  jurisdiction!: string;

  @IsString()
  @MinLength(1)
  category!: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
