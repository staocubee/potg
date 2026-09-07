import { IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

const AGREEMENT_TYPES = ['temporary_ownership', 'proceeds_share'] as const;

// Cross-field requirements (ownershipPercentage+termMonths for
// temporary_ownership, proceedsSharePercentage for proceeds_share) are
// checked in the service, not here — matching this codebase's usual
// "simple DTO, service-level validation for anything that depends on
// another field's value" convention.
export class CreateDevelopmentAgreementDto {
  @IsEmail()
  developerEmail!: string;

  @IsIn(AGREEMENT_TYPES)
  agreementType!: (typeof AGREEMENT_TYPES)[number];

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100)
  ownershipPercentage?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  termMonths?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100)
  proceedsSharePercentage?: number;

  @IsString()
  @MinLength(10)
  terms!: string;
}
