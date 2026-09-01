import { IsOptional, IsString } from 'class-validator';

export class CheckoutCartDto {
  @IsString()
  supplierId!: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  deliveryAddress?: string;
}
