import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { setAuthCookies, clearAuthCookies } from './cookie.util';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Sets the session as httpOnly cookies (see cookie.util.ts) rather than
  // returning the token pair in the response body — the latter would
  // defeat the whole point (any XSS that can read a fetch response can
  // read a JSON body just as easily as localStorage). The response body
  // only ever carries non-sensitive info the client actually needs to
  // render something.
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken, ...rest } = await this.auth.register(dto);
    setAuthCookies(res, { accessToken, refreshToken });
    return rest;
  }

  // Credential-guessing target — 5 attempts/minute per IP, well under the
  // module-wide default (100/min) set in AppModule.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken, ...rest } = await this.auth.login(dto.email, dto.password);
    setAuthCookies(res, { accessToken, refreshToken });
    return rest;
  }

  // One endpoint for both "register" and "log in" via Google — see
  // AuthService.googleAuth's own comment for why a single call can mean
  // either depending on whether this email/googleId has signed in before.
  // Same 5/min cap as login: this is a credential-verification endpoint
  // too, even though the credential is a Google-issued token rather than
  // a password.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('google')
  async google(@Body() dto: GoogleAuthDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken, ...rest } = await this.auth.googleAuth(dto.idToken, dto.inviteToken);
    setAuthCookies(res, { accessToken, refreshToken });
    return rest;
  }

  // Unauthenticated on purpose — the refresh token itself is the
  // credential, the same way a password is on /login. JwtAuthGuard would
  // refuse it anyway (it only accepts type: 'access' tokens). Reads the
  // credential from the httpOnly refresh_token cookie now instead of the
  // request body — there's nowhere else for it to have come from once
  // this app's own JS can no longer see it. CsrfGuard (global, see
  // AppModule) still checks this route: it acts on the cookie's ambient
  // authority the same way any other mutating route does.
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken, ...rest } = await this.auth.refresh(req.cookies?.['refresh_token']);
    setAuthCookies(res, { accessToken, refreshToken });
    return rest;
  }

  // Revokes the current refresh token early instead of leaving it valid
  // until its own 30-day expiry, and clears all three auth cookies.
  // Unauthenticated for the same reason /refresh is: the refresh token
  // itself is the credential this acts on, read from its cookie.
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.logout(req.cookies?.['refresh_token']);
    clearAuthCookies(res);
    return result;
  }

  // The other half of moving the token out of the response body: the
  // client used to decode its own JWT (see the old lib/auth.tsx) to know
  // who's signed in and when the access token expires — it can't do that
  // anymore, so it asks instead. Only ever needs to be called once after
  // establishing a session (or on page load, to confirm one is still
  // live), not on every request.
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: { id: string; email: string }) {
    return user;
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
