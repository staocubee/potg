import { IsISO8601, IsNotEmpty, IsString } from 'class-validator';

// All three fields together or not at all — same shape
// SetVendorBankDetailsDto's pair takes, see the schema comment on
// Vendor.licenseNumber for why there's no separate "clear" endpoint.
export class SetVendorLicenseDto {
  @IsString()
  @IsNotEmpty()
  licenseNumber!: string;

  @IsString()
  @IsNotEmpty()
  licenseIssuingBody!: string;

  @IsISO8601()
  licenseExpiresAt!: string;
}
