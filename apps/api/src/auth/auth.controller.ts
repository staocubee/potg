import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  // Credential-guessing target — 5 attempts/minute per IP, well under the
  // module-wide default (100/min) set in AppModule.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  // Unauthenticated on purpose — the refresh token itself is the
  // credential, the same way a password is on /login. JwtAuthGuard would
  // refuse it anyway (it only accepts type: 'access' tokens).
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  // Revokes the given refresh token early instead of leaving it valid
  // until its own 30-day expiry. Unauthenticated for the same reason
  // /refresh is: the refresh token itself is the credential this acts on.
  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  // Same reasoning as login: an unlimited forgot-password endpoint is both
  // a mail-bomb vector (real deployments) and, combined with the timing of
  // its generic response, worth capping regardless.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  // Reset tokens are 32 bytes of randomness, so brute-forcing one isn't
  // remotely practical even unthrottled — this limit is about consistency
  // with the rest of the unauthenticated auth surface, not a real attack
  // this closes on its own.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.newPassword);
  }

  // Lets a signed-in user see which accounts they can switch into before
  // choosing the X-Account-Id header for subsequent requests.
  @UseGuards(JwtAuthGuard)
  @Get('accounts')
  listAccounts(@CurrentUser() user: { id: string }) {
    return this.auth.listAccounts(user.id);
  }
}
