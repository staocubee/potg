import { randomBytes } from 'crypto';
import { Response } from 'express';

// Shared by every AuthController route that establishes or clears a
// session (login, register, refresh, logout) — one place to get the
// cookie options right rather than four places that could each drift.
//
// `sameSite: 'lax'` + no `secure` in dev works for this scaffold's own
// topology: the web app and API run on `localhost` at different ports,
// which the SameSite spec treats as the *same site* (site is scoped by
// registrable domain, not port — unlike CORS/fetch's same-*origin*
// check, which does include the port and is why CORS still needs
// `credentials: true` above in main.ts even though SameSite doesn't
// block the cookie). A production deployment across genuinely different
// registrable domains needs `sameSite: 'none'` + `secure: true` instead,
// which browsers only honor over HTTPS — see the README.
const isProd = process.env.NODE_ENV === 'production';
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h — matches AuthService.ACCESS_TOKEN_TTL
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d — matches AuthService.REFRESH_TOKEN_TTL

const baseCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax' as const,
};

export function setAuthCookies(res: Response, tokens: { accessToken: string; refreshToken: string }) {
  res.cookie('access_token', tokens.accessToken, { ...baseCookieOptions, path: '/', maxAge: ACCESS_TOKEN_TTL_MS });
  // Scoped to /auth — the only paths that ever need to read it
  // (POST /auth/refresh, POST /auth/logout) — so it isn't sent on every
  // other request for no reason.
  res.cookie('refresh_token', tokens.refreshToken, { ...baseCookieOptions, path: '/auth', maxAge: REFRESH_TOKEN_TTL_MS });
  // Deliberately NOT httpOnly — this is the CSRF double-submit token
  // (see CsrfGuard): client JS reads it from document.cookie and echoes
  // it back as the X-CSRF-Token header on mutating requests. It carries
  // no authority on its own, only proves the request came from a page
  // that could read this origin's cookies (i.e. same-site JS, not a
  // forged cross-site form/fetch).
  res.cookie('csrf_token', randomBytes(16).toString('hex'), { ...baseCookieOptions, httpOnly: false, path: '/', maxAge: REFRESH_TOKEN_TTL_MS });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie('access_token', { path: '/' });
  res.clearCookie('refresh_token', { path: '/auth' });
  res.clearCookie('csrf_token', { path: '/' });
}
