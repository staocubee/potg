import { IsEmail, IsOptional, IsString } from 'class-validator';

export class CreateInquiryDto {
  @IsString()
  message!: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;
}
