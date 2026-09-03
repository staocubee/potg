import { IsIn, IsOptional, IsString } from 'class-validator';

const BANK_TRANSFER_PROVIDERS = ['paystack', 'flutterwave'] as const;

export class SetVendorBankDetailsDto {
  @IsString()
  bankAccountNumber!: string;

  @IsString()
  bankCode!: string;

  // Which gateway to resolve/save these against — defaults to "paystack"
  // for backward compatibility with callers that predate Flutterwave
  // support. PayPal isn't in this list: it pays an email address, not a
  // bank account — see SetPaypalPayoutEmailDto/setPaypalPayoutEmail.
  @IsOptional()
  @IsIn(BANK_TRANSFER_PROVIDERS)
  provider?: string;
}
