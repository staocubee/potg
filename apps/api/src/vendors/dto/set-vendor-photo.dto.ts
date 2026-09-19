import { IsUrl } from 'class-validator';

export class SetVendorPhotoDto {
  @IsUrl({ require_tld: false })
  photoUrl!: string;
}
