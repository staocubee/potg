import { IsIn, IsOptional, IsString } from 'class-validator';

// Freeform on purpose for this scaffold — Module 7's real category taxonomy
// (with sub-categories, licensing requirements per category, etc.) is a
// market-specific config problem, not a schema one.
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
