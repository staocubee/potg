import { IsIn, IsOptional, IsString } from 'class-validator';

const ACCOUNT_TYPES = ['INDIVIDUAL', 'FAMILY', 'COMPANY', 'VENDOR', 'SUPPLIER', 'TENANT'] as const;
const VENDOR_ROLES = ['vendor', 'inspector'] as const;

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

  // Only meaningful when accountType is VENDOR — lets the account pick
  // the narrower "inspector" role (Module 8: inspection work only, no
  // marketplace bidding/dispute/rental permissions) instead of the
  // default "vendor" role. A fixed enum, never free text — see
  // AccountsService.create, which is the only place this is read and
  // ignores it for every other accountType.
  @IsOptional()
  @IsIn(VENDOR_ROLES)
  vendorRole?: (typeof VENDOR_ROLES)[number];
}
