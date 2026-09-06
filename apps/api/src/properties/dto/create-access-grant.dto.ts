import { IsBoolean, IsOptional, IsString } from 'class-validator';

// Module 21's "Family representative access" — wires up PropertyAccessGrant,
// a model that has existed in this schema since Module 1 and was never
// once read or written anywhere until now (same "dead field" shape
// Account.status/timezone were both in before their own passes). Only
// canApprovePayments is actually enforced this pass (see
// PaymentsService.releaseMilestone's own comment) — canView/canEdit are
// stored but not yet checked anywhere, an honest gap, not a silent one.
export class CreateAccessGrantDto {
  @IsString()
  accountMemberId!: string;

  @IsOptional()
  @IsBoolean()
  canView?: boolean;

  @IsOptional()
  @IsBoolean()
  canEdit?: boolean;

  @IsOptional()
  @IsBoolean()
  canApprovePayments?: boolean;
}
