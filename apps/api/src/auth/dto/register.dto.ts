import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  name!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  // Security fix: MinLength(8) alone let through common weak passwords
  // (e.g. "password") with nothing else required. @MaxLength(72) matches
  // bcrypt's own input limit (AuthService hashes with bcryptjs, which
  // silently truncates past 72 bytes — better to reject a too-long
  // password outright than truncate it invisibly). The @Matches
  // requirement is deliberately mild — one letter and one digit — not a
  // symbol/case-class policy that mostly just pushes users toward
  // "Password1"-style patterns.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'password must include at least one letter and one number' })
  password!: string;

  // Set when registering from an invite link (GET /invites/:token) —
  // AuthService.register validates and consumes it in the same call that
  // creates the User, so accepting an invite never needs a second request
  // for someone who didn't have an account yet.
  @IsOptional()
  @IsString()
  inviteToken?: string;
}
