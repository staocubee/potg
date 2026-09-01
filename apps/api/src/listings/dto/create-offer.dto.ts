import { IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateOfferDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  message?: string;
}
