import { IsString } from 'class-validator';

export class SetVendorBankDetailsDto {
  @IsString()
  bankAccountNumber!: string;

  @IsString()
  bankCode!: string;
}
