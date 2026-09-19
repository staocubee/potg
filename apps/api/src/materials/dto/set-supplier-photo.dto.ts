import { IsUrl } from 'class-validator';

export class SetSupplierPhotoDto {
  @IsUrl({ require_tld: false })
  photoUrl!: string;
}
