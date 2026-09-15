import { IsOptional, IsString } from 'class-validator';

// Deliberately no stricter validation than CreateAccountDto already
// applies to these same three fields — currency/timezone are plain
// free text there too, no enum enforced anywhere in this codebase.
export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}
