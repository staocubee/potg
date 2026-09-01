import { IsEmail, IsString } from 'class-validator';

// If `email` already has a User, this adds them immediately. If not,
// AccountsService.addMember now creates a pending AccountInvite instead
// of failing — see that method and InvitesController.
export class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsString()
  roleKey!: string; // e.g. "family_admin", "viewer"
}
