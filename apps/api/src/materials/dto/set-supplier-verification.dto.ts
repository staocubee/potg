import { IsIn } from 'class-validator';

const VERIFICATION_STATUSES = ['not_verified', 'pending', 'verified'] as const;

export class SetSupplierVerificationDto {
  @IsIn(VERIFICATION_STATUSES)
  status!: string;
}
