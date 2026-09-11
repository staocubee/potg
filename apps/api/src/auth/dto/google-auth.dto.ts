import { IsOptional, IsString } from 'class-validator';

export class GoogleAuthDto {
  // The ID token Google Identity Services' own JS widget hands back in
  // its callback — a signed JWT this endpoint verifies server-side
  // against Google's own public keys (see AuthService.googleAuth), never
  // trusted as-is.
  @IsString()
  idToken!: string;

  // Same optional invite-linking as RegisterDto.inviteToken — only ever
  // consumed the one time this call ends up creating a brand-new User
  // (see AuthService.googleAuth's own comment for why a returning user's
  // stale invite link is ignored here, same as register() never reaches
  // its own invite check for an already-registered email).
  @IsOptional()
  @IsString()
  inviteToken?: string;
}
