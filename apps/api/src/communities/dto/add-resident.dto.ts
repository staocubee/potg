import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

const RESIDENT_TYPES = ['owner', 'tenant'] as const;

export class AddResidentDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  unitNumber!: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsIn(RESIDENT_TYPES)
  residentType?: string;
}
