import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

// The other half of moving auth off localStorage and into httpOnly
// cookies: once the browser attaches credentials to every request
// automatically, a malicious page can trigger authenticated mutations
// the user never intended (classic CSRF) — something that simply wasn't
// possible while the access token lived in localStorage and had to be
// attached by this app's own JS. Double-submit-cookie pattern: login/
// register/refresh (see cookie.util.ts) also set a non-httpOnly
// `csrf_token` cookie; this guard requires every mutating request to echo
// that same value back as an `X-CSRF-Token` header. A cross-site
// attacker's page can trigger the cookie-carrying request but can't read
// this origin's cookies to know what value to put in the header, so the
// two values only ever match for a request this app's own JS actually
// made.
//
// Global (see AppModule) rather than bolted onto every controller's own
// @UseGuards(JwtAuthGuard, ...) list — the risk this closes applies to
// every mutating endpoint uniformly, cookie-authenticated or not (see the
// two exceptions below), so one central guard is far less likely to miss
// a spot than repeating it across 15+ controllers.
const SKIP_PATHS = new Set(['/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (SAFE_METHODS.has(req.method)) return true;
    // These four don't run on any pre-existing session cookie's ambient
    // authority — the credential each one acts on (a password, an invite
    // token, a password-reset token) is already explicit in the request
    // body, so there's no "ridden" authority for CSRF to exploit. Every
    // other mutating route, /auth/refresh and /auth/logout included
    // (both act on the refresh_token cookie's ambient authority), gets
    // checked.
    if (SKIP_PATHS.has(req.path)) return true;

    const cookieToken = req.cookies?.['csrf_token'];
    const headerToken = req.headers['x-csrf-token'];
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw new ForbiddenException('Missing or invalid CSRF token');
    }
    return true;
  }
}
