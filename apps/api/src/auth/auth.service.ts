import { BadRequestException, ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';

// Access tokens are short-lived and carry `type: 'access'` — JwtAuthGuard
// rejects anything else, so a leaked/stolen refresh token can't be used
// directly against a protected route. Refresh tokens are long-lived and
// carry `type: 'refresh'` plus a `jti` that's persisted as a RefreshToken
// row: the JWT signature is still what proves possession, but the row is
// what lets a token be revoked early (logout, password reset) instead of
// staying valid until its own 30-day expiry no matter what. refresh()
// rotates on every call — revokes the row being redeemed, inserts a new
// one — so a stolen-and-replayed refresh token stops working the moment
// the legitimate client refreshes past it.
const ACCESS_TOKEN_TTL = '1h';
const REFRESH_TOKEN_TTL = '30d';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(input: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }
    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        passwordHash,
      },
    });
    return this.issueTokenPair(user.id, user.email);
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid email or password');
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid email or password');
    return this.issueTokenPair(user.id, user.email);
  }

  // Called from POST /auth/refresh, unauthenticated (the refresh token
  // itself is the credential) — swaps a still-valid refresh token for a
  // brand new access+refresh pair. Rotating the refresh token too (rather
  // than just reissuing the access token) narrows the replay window on the
  // old one, at the cost of the client having to persist the new refresh
  // token every time it refreshes — apps/web's ApiClient does this
  // automatically, see its configureAuthSession().
  async refresh(refreshToken: string) {
    let payload: { sub: string; email: string; type: string; jti?: string };
    try {
      payload = this.jwt.verify(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (payload.type !== 'refresh' || !payload.jti) {
      throw new UnauthorizedException('Not a refresh token');
    }
    const stored = await this.prisma.refreshToken.findUnique({ where: { jti: payload.jti } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Account no longer active');
    }
    // Rotate: this token can't be redeemed a second time, closing the
    // replay window if it was ever intercepted.
    await this.prisma.refreshToken.update({ where: { jti: payload.jti }, data: { revokedAt: new Date() } });
    return this.issueTokenPair(user.id, user.email);
  }

  // POST /auth/logout — revokes one refresh token early instead of letting
  // it ride out its 30-day expiry. Same "don't confirm anything to the
  // caller" shape as forgotPassword: an already-invalid or unrecognized
  // token still gets a success response, since logout isn't a place to
  // leak whether a token was real.
  async logout(refreshToken: string) {
    let payload: { type: string; jti?: string };
    try {
      payload = this.jwt.verify(refreshToken);
    } catch {
      return { message: 'Logged out.' };
    }
    if (payload.type === 'refresh' && payload.jti) {
      await this.prisma.refreshToken.updateMany({
        where: { jti: payload.jti, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { message: 'Logged out.' };
  }

  // Returns the accounts this user can act as, so a client can prompt for
  // account switching (individual / family / company / vendor) before
  // sending the X-Account-Id header on subsequent requests.
  async listAccounts(userId: string) {
    const memberships = await this.prisma.accountMember.findMany({
      where: { userId, status: 'active' },
      include: { account: true, role: true },
    });
    type Membership = {
      accountId: string;
      account: { name: string; accountType: string };
      role: { key: string };
    };
    return memberships.map((m: Membership) => ({
      accountId: m.accountId,
      accountName: m.account.name,
      accountType: m.account.accountType,
      role: m.role.key,
    }));
  }

  // No email provider is wired up anywhere in this scaffold (payments are
  // simulated the same way — see src/payments's own comment), so this
  // can't actually email a reset link. It logs the link server-side (where
  // a real implementation would hand it to an email service instead) and,
  // ONLY because there's no other channel for a developer/demo user to
  // receive it, also returns the raw token in the response. A real
  // deployment must delete the `resetToken` line from the return value
  // below — returning it defeats the point of a reset flow (anyone who can
  // call this endpoint for an email could reset that account's password).
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Same response whether the email exists or not — don't let this
    // endpoint be used to enumerate registered accounts.
    const generic = { message: 'If that email has an account, a password reset link has been generated.' };
    if (!user) return generic;

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
    });

    const resetLink = `${process.env.WEB_APP_URL ?? 'http://localhost:3000'}/reset-password?token=${rawToken}`;
    this.logger.log(`Password reset requested for ${email} — link (would be emailed): ${resetLink}`);

    // TODO(production): stop returning resetToken once a real email
    // provider sends resetLink instead — see the method comment above.
    return { ...generic, resetToken: rawToken };
  }

  async resetPassword(rawToken: string, newPassword: string) {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('This reset link is invalid or has expired — request a new one');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      // A password reset should invalidate any refresh token issued before
      // it — otherwise a session started before the compromise that
      // triggered this reset just keeps working for up to 30 more days.
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { message: 'Password updated — sign in with your new password.' };
  }

  private async issueTokenPair(userId: string, email: string) {
    const jti = randomUUID();
    const accessToken = this.jwt.sign({ sub: userId, email, type: 'access' }, { expiresIn: ACCESS_TOKEN_TTL });
    const refreshToken = this.jwt.sign({ sub: userId, email, type: 'refresh', jti }, { expiresIn: REFRESH_TOKEN_TTL });
    await this.prisma.refreshToken.create({
      data: { userId, jti, expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) },
    });
    return { accessToken, refreshToken };
  }
}
