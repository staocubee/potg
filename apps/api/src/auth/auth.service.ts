import { BadRequestException, ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { EmailService } from '../notifications/email.service';

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
// Longer than the password reset token's TTL above — verifying an email
// is a lower-stakes, less time-sensitive action than resetting a
// password (nothing about the account changes access until the account
// holder actually clicks it), so a more forgiving window is the right
// tradeoff here.
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Security fix: POST /auth/login's own @Throttle (5/min) is a real
// per-IP defense, but it never tracked the *account* being guessed —
// a distributed or slow-and-low attacker could brute-force one victim's
// password indefinitely. This is the per-account complement: locked out
// for LOCKOUT_DURATION_MS once MAX_FAILED_LOGIN_ATTEMPTS wrong passwords
// land in a row, reset on any successful login. Checked live against
// User.lockedUntil rather than a cron unlocking it — same "compute on
// read" restraint this codebase already applies to expiring state
// elsewhere (PropertyDevelopmentAgreement.expiresAt, Project.quotesDeadline).
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  private readonly googleClient: OAuth2Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {
    // Built once regardless of whether GOOGLE_OAUTH_CLIENT_ID is actually
    // set — google-auth-library only uses the id at verify time (passed
    // again as `audience` below), so an empty-string client doesn't throw
    // here; the explicit check at the top of googleAuth is what actually
    // refuses the request cleanly when it's unset.
    this.googleClient = new OAuth2Client(this.config.get<string>('GOOGLE_OAUTH_CLIENT_ID', ''));
  }

  // Shared by register() (email+password) and googleAuth() (Google) — one
  // validate-then-return, not two copies of the same sha256+status+expiry+
  // email-match checks. Doesn't consume the invite itself (both callers
  // do that inside their own transaction, once the User row they need for
  // AccountMember.userId actually exists) — just proves it's usable.
  // AccountsService.acceptInvite has a similar validate-then-consume shape
  // for the already-registered case (InvitesController) — kept separate
  // rather than shared because that path already has a signed-in user and
  // this one is still creating one.
  private async validateInvite(inviteToken: string, email: string): Promise<{ id: string; accountId: string; roleId: string }> {
    const tokenHash = createHash('sha256').update(inviteToken).digest('hex');
    const found = await this.prisma.accountInvite.findUnique({ where: { tokenHash } });
    if (!found || found.status !== 'pending' || found.expiresAt < new Date()) {
      throw new BadRequestException('This invite is invalid or has expired');
    }
    if (found.email.toLowerCase() !== email.toLowerCase()) {
      throw new BadRequestException('This invite was sent to a different email address');
    }
    return found;
  }

  async register(input: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    // Validated before the User is created, not after: a bad/expired/
    // mismatched invite token should fail registration cleanly rather than
    // leaving a signed-up user whose invite silently didn't take.
    let invite: { id: string; accountId: string; roleId: string } | null = null;
    if (input.inviteToken) {
      invite = await this.validateInvite(input.inviteToken, input.email);
    }

    // Security hardening: bumped from bcryptjs's own common "10" example
    // value to 12, OWASP's current minimum recommended work factor.
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        passwordHash,
      },
    });

    if (invite) {
      await this.prisma.$transaction([
        this.prisma.accountMember.create({ data: { accountId: invite.accountId, userId: user.id, roleId: invite.roleId } }),
        this.prisma.accountInvite.update({ where: { id: invite.id }, data: { status: 'accepted', acceptedAt: new Date() } }),
      ]);
    }

    // Fire-and-forget in spirit (never fails registration itself — same
    // "an enrichment failing shouldn't fail the action that triggered it"
    // reasoning InAppNotificationsService.notify already follows), but
    // still awaited so the server-side fallback log line (see
    // sendVerificationEmail) actually lands before this request finishes,
    // useful for a developer testing this without RESEND_API_KEY set.
    try {
      await this.sendVerificationEmail(user.id, user.email);
    } catch (err) {
      this.logger.error(`Failed to send verification email to ${user.email}: ${err instanceof Error ? err.message : err}`);
    }

    return this.issueTokenPair(user.id, user.email);
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid email or password');
    // Checked before the password itself — a locked account rejects every
    // attempt (even the correct password) until the lockout window passes,
    // same as any standard account-lockout implementation.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new UnauthorizedException(`Too many failed attempts — try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}`);
    }
    // A Google-only account (see User.passwordHash's own schema comment)
    // has nothing to compare against — bcrypt.compare would throw on a
    // null second argument rather than fail cleanly, so this is checked
    // explicitly instead of just letting that happen.
    if (!user.passwordHash) {
      throw new UnauthorizedException(
        'This account signs in with Google — use "Continue with Google", or use "Forgot password" to set one.',
      );
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await this.registerFailedLogin(user.id, user.failedLoginAttempts);
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
    }
    return this.issueTokenPair(user.id, user.email);
  }

  private async registerFailedLogin(userId: string, currentAttempts: number) {
    const attempts = currentAttempts + 1;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: attempts >= MAX_FAILED_LOGIN_ATTEMPTS ? new Date(Date.now() + LOCKOUT_DURATION_MS) : undefined,
      },
    });
  }

  // Real Google Sign-In (this pass) — one endpoint for both "register" and
  // "log in" (see README's own comment on this feature for why: Google
  // already proves the email, so there's no separate "create an account"
  // step the way password auth needs one). idToken is the JWT Google
  // Identity Services' own browser widget produces; verified here against
  // Google's own public keys via google-auth-library — never decoded and
  // trusted directly, the same "don't trust what the client claims"
  // reasoning every gateway verify() in this codebase already follows.
  async googleAuth(idToken: string, inviteToken?: string) {
    const clientId = this.config.get<string>('GOOGLE_OAUTH_CLIENT_ID', '');
    if (!clientId) {
      throw new BadRequestException('Google sign-in is not configured on this server — set GOOGLE_OAUTH_CLIENT_ID');
    }

    let payload: { sub: string; email?: string; email_verified?: boolean; name?: string } | undefined;
    try {
      const ticket = await this.googleClient.verifyIdToken({ idToken, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Invalid Google sign-in token');
    }
    if (!payload?.email) {
      throw new UnauthorizedException("Google didn't return an email for this account");
    }
    // Google only ever sets this false for an address it hasn't itself
    // confirmed the account holder controls (e.g. a G Suite domain admin
    // added it without the user verifying) — refusing here is what makes
    // the auto-link below (email match, no extra proof) safe.
    if (!payload.email_verified) {
      throw new UnauthorizedException("This Google account's email isn't verified");
    }

    const googleId = payload.sub;
    const email = payload.email;

    let user = await this.prisma.user.findUnique({ where: { googleId } });
    let isNewUser = false;

    if (!user) {
      const existingByEmail = await this.prisma.user.findUnique({ where: { email } });
      if (existingByEmail) {
        // Same person, a second way in — link rather than refuse or
        // create a duplicate row for the same email (email is @unique,
        // so a duplicate isn't even possible; this is the deliberate
        // choice of *which* outcome, not a workaround for a constraint).
        // Google just proved control of this address too, so this is
        // also a legitimate moment to mark it verified if it wasn't
        // already — never overwrites an earlier, real verification
        // timestamp with a later one.
        user = await this.prisma.user.update({
          where: { id: existingByEmail.id },
          data: { googleId, emailVerifiedAt: existingByEmail.emailVerifiedAt ?? new Date() },
        });
      } else {
        // Brand new — same optional invite-consumption register() does,
        // only reachable here because no User with this email existed a
        // moment ago (an existing account's stale invite link is simply
        // ignored, same as register()'s own ConflictException path never
        // reaches its own invite check for an already-registered email).
        // emailVerifiedAt is set directly, no token/email round-trip —
        // Google already did that proof.
        const invite = inviteToken ? await this.validateInvite(inviteToken, email) : null;
        user = await this.prisma.user.create({
          data: { name: payload.name ?? email.split('@')[0], email, googleId, emailVerifiedAt: new Date() },
        });
        if (invite) {
          await this.prisma.$transaction([
            this.prisma.accountMember.create({ data: { accountId: invite.accountId, userId: user.id, roleId: invite.roleId } }),
            this.prisma.accountInvite.update({ where: { id: invite.id }, data: { status: 'accepted', acceptedAt: new Date() } }),
          ]);
        }
        isNewUser = true;
      }
    }

    return { ...(await this.issueTokenPair(user.id, user.email)), isNewUser };
  }

  // Called from POST /auth/refresh, unauthenticated (the refresh token
  // itself is the credential) — swaps a still-valid refresh token for a
  // brand new access+refresh pair. Rotating the refresh token too (rather
  // than just reissuing the access token) narrows the replay window on the
  // old one, at the cost of the client having to persist the new refresh
  // token every time it refreshes — apps/web's ApiClient does this
  // automatically, see its configureAuthSession().
  async refresh(refreshToken: string | undefined) {
    if (!refreshToken) throw new UnauthorizedException('Missing refresh token');
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
  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return { message: 'Logged out.' };
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

  // Backs GET /auth/me — a real DB lookup rather than just echoing the
  // JWT payload (id/email only) JwtAuthGuard already put on the request,
  // specifically so `emailVerified` is always fresh: clicking a
  // verification link should be reflected the moment the app asks again,
  // not up to an hour later when the access token happens to be
  // reissued. Low-traffic enough (that route's own comment: "only ever
  // needs to be called once... on page load") that the extra query costs
  // nothing worth avoiding.
  async getMe(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { id: user.id, email: user.email, emailVerified: !!user.emailVerifiedAt };
  }

  // Shared by register() (fire-and-forget on signup) and
  // resendVerificationEmail (an authenticated user asking for a fresh
  // one) — one place that actually creates the token and sends the mail,
  // same "logged + returned raw when no provider is configured" fallback
  // forgotPassword already uses, for the same reason (a developer/demo
  // environment with no RESEND_API_KEY still needs a way to complete the
  // flow).
  private async sendVerificationEmail(userId: string, email: string): Promise<{ sent: boolean; rawToken: string }> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    await this.prisma.emailVerificationToken.create({
      data: { userId, tokenHash, expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS) },
    });

    const verifyLink = `${process.env.WEB_APP_URL ?? 'http://localhost:3000'}/verify-email?token=${rawToken}`;
    const sent = await this.email.send({
      to: email,
      subject: 'Verify your PropertyOnTheGo email',
      html: `<p>Confirm this is your email address to finish setting up your PropertyOnTheGo account.</p><p><a href="${verifyLink}">Verify your email</a></p><p>This link expires in 24 hours. If you didn't create this account, you can ignore this email.</p>`,
      text: `Verify your PropertyOnTheGo email: ${verifyLink}\n\nThis link expires in 24 hours. If you didn't create this account, you can ignore this email.`,
    });
    const linkStatus = sent
      ? '(emailed)'
      : this.email.isConfigured
        ? '(email send failed — see the EmailService error above)'
        : '(would be emailed, no RESEND_API_KEY configured)';
    this.logger.log(`Verification email for ${email} — link ${linkStatus}: ${verifyLink}`);

    return { sent, rawToken };
  }

  async verifyEmail(rawToken: string) {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const record = await this.prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('This verification link is invalid or has expired — request a new one');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
      this.prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
    return { message: 'Email verified.' };
  }

  // The authenticated "resend" action behind the banner's own button —
  // unlike forgotPassword, this never needs the "don't confirm whether
  // the email exists" non-enumeration shape (the caller is already
  // signed in as this exact user, JwtAuthGuard already proved that), so
  // it can just say plainly whether there was anything to resend.
  async resendVerificationEmail(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) {
      return { message: 'This email is already verified.', alreadyVerified: true };
    }
    const { sent, rawToken } = await this.sendVerificationEmail(user.id, user.email);
    const generic = { message: 'Verification email sent.', alreadyVerified: false };
    if (sent) return generic;
    return { ...generic, verificationToken: rawToken };
  }

  // Returns the accounts this user can act as, so a client can prompt for
  // account switching (individual / family / company / vendor) before
  // sending the X-Account-Id header on subsequent requests. `permissions`
  // (added this pass) is the same key set PermissionsGuard checks
  // server-side — lets the frontend gate a button/action before the user
  // clicks it, rather than only ever finding out via a 403 after the
  // fact. Never the actual authorization boundary on its own: a stale or
  // tampered client value still hits the real PermissionsGuard check on
  // every request, this is purely a UX improvement.
  async listAccounts(userId: string) {
    const memberships = await this.prisma.accountMember.findMany({
      where: { userId, status: 'active' },
      include: { account: true, role: { include: { permissions: { include: { permission: true } } } } },
    });
    type Membership = {
      accountId: string;
      account: { name: string; accountType: string };
      role: { key: string; permissions: { permission: { key: string } }[] };
    };
    return memberships.map((m: Membership) => ({
      accountId: m.accountId,
      accountName: m.account.name,
      accountType: m.account.accountType,
      role: m.role.key,
      permissions: m.role.permissions.map((rp) => rp.permission.key),
    }));
  }

  // EmailService.send actually delivers this when RESEND_API_KEY is set
  // (see that file — Resend's sandbox sender still only reaches the API
  // key's own account without a verified domain, an external constraint,
  // not this code's). Without a key configured, this falls back to the
  // original scaffold behavior: log the link server-side and return the
  // raw token in the response, since there's no other channel for a
  // developer/demo user to receive it. That fallback only fires when
  // `sent` comes back false — once a provider is actually delivering,
  // returning the token in the response would defeat the point of a reset
  // flow (anyone who could call this endpoint for an email could reset
  // that account's password), so it's dropped the moment sending succeeds.
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
    const sent = await this.email.send({
      to: email,
      subject: 'Reset your PropertyOnTheGo password',
      html: `<p>We received a request to reset your PropertyOnTheGo password.</p><p><a href="${resetLink}">Reset your password</a></p><p>This link expires in one hour. If you didn't request this, you can ignore this email.</p>`,
      text: `Reset your PropertyOnTheGo password: ${resetLink}\n\nThis link expires in one hour. If you didn't request this, you can ignore this email.`,
    });
    const linkStatus = sent
      ? '(emailed)'
      : this.email.isConfigured
        ? '(email send failed — see the EmailService error above)'
        : '(would be emailed, no RESEND_API_KEY configured)';
    this.logger.log(`Password reset requested for ${email} — link ${linkStatus}: ${resetLink}`);

    if (sent) return generic;
    return { ...generic, resetToken: rawToken };
  }

  async resetPassword(rawToken: string, newPassword: string) {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('This reset link is invalid or has expired — request a new one');
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: record.userId } });
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          // Clicking a link mailed to this exact address is the same
          // real proof of inbox control email verification is otherwise
          // built around — never overwrites an earlier, real
          // verification timestamp with a later one.
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        },
      }),
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
