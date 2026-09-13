import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

// The audit's own finding: PropertyOwner (%-split multi-owner) has
// existed in the schema since Module 1 and was completely inert — no
// create/edit endpoint anywhere, only ever written as a side-effect of
// accepting a temporary_ownership development agreement (see
// DevelopmentAgreementsService.applyAccept). This is the real,
// user-facing way to add one directly.
export class AddPropertyOwnerDto {
  @IsIn(['account', 'user'])
  ownerType!: 'account' | 'user';

  // Exactly one of these two must be set, matched to ownerType — checked
  // in PropertiesService.addPropertyOwner, same "the service enforces
  // the business rule" convention this codebase already uses for
  // Dispute's own exactly-one-of-projectId/orderId shape.
  @IsOptional()
  @IsString()
  ownerAccountId?: string;

  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @IsNumber()
  @Min(0.01)
  @Max(100)
  ownershipPercentage!: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
