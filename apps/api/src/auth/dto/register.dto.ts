import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  name!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @MinLength(8)
  password!: string;

  // Set when registering from an invite link (GET /invites/:token) —
  // AuthService.register validates and consumes it in the same call that
  // creates the User, so accepting an invite never needs a second request
  // for someone who didn't have an account yet.
  @IsOptional()
  @IsString()
  inviteToken?: string;
}
