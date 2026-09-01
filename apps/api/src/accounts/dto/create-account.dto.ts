import { IsIn, IsString } from 'class-validator';

const ACCOUNT_TYPES = ['INDIVIDUAL', 'FAMILY', 'COMPANY', 'VENDOR', 'SUPPLIER'] as const;

export class CreateAccountDto {
  @IsIn(ACCOUNT_TYPES)
  accountType!: (typeof ACCOUNT_TYPES)[number];

  @IsString()
  name!: string;

  @IsString()
  country!: string;

  @IsString()
  currency!: string;

  @IsString()
  timezone!: string;
}
