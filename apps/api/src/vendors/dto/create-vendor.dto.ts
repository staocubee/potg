import { IsIn, IsOptional, IsString } from 'class-validator';

// Freeform on purpose for this scaffold — Module 7's real category taxonomy
// (with sub-categories, licensing requirements per category, etc.) is a
// market-specific config problem, not a schema one.
//
// The audit's own finding on Workflow 4: "No architect/engineer role,
// permission, or vendor category anywhere. The fixed service-category
// dropdown has no such option — hiring one would silently reuse the
// generic contractor flow." architect/engineer are added here as real,
// selectable categories — hiring one still reuses the same generic
// quote/assignment flow every other category does, which is the
// audit's own description of the *remaining*, deliberately-unbuilt gap
// (a distinct professional-services workflow), not a bug this closes.
const SERVICE_CATEGORIES = [
  'renovation',
  'plumbing',
  'electrical',
  'landscaping',
  'painting',
  'roofing',
  'interior_design',
  'general_contracting',
  'security_installation',
  'cleaning',
  'architect',
  'engineer',
] as const;

export class CreateVendorDto {
  @IsString()
  businessName!: string;

  @IsIn(SERVICE_CATEGORIES)
  serviceCategory!: string;

  @IsOptional()
  @IsString()
  locationCoverage?: string;
}
