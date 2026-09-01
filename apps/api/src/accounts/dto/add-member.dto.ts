import { IsEmail, IsString } from 'class-validator';

// Scaffold-level: adds an EXISTING user to an account with a role. A real
// invite/accept-by-email flow (Module 1's "Vendor onboarding" /
// family-representative access) is future work — see README.
export class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsString()
  roleKey!: string; // e.g. "family_admin", "viewer"
}
