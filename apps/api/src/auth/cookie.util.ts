import { randomBytes } from 'crypto';
import { Response } from 'express';

// Shared by every AuthController route that establishes or clears a
// session (login, register, refresh, logout) — one place to get the
// cookie options right rather than four places that could each drift.
const isProd = process.env.NODE_ENV === 'production';
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h — matches AuthService.ACCESS_TOKEN_TTL
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d — matches AuthService.REFRESH_TOKEN_TTL

const baseCookieOptions = {
  httpOnly: true,
  secure: isProd,
  // 'none' is required in production for cross-subdomain requests over HTTPS.
  // 'lax' is used in local dev since localhost across ports is treated as the same site.
  sameSite: isProd ? ('none' as const) : ('lax' as const),
  // Leading dot allows both root domain and subdomains (www and api) to share cookies in production.
  domain: isProd ? '.propertyonthego.com.ng' : undefined,
};

export function setAuthCookies(res: Response, tokens: { accessToken: string; refreshToken: string }) {
  res.cookie('access_token', tokens.accessToken, { 
    ...baseCookieOptions, 
    path: '/', 
    maxAge: ACCESS_TOKEN_TTL_MS 
  });

  // Scoped to /auth — the only paths that ever need to read it
  // (POST /auth/refresh, POST /auth/logout)
  res.cookie('refresh_token', tokens.refreshToken, { 
    ...baseCookieOptions, 
    path: '/auth', 
    maxAge: REFRESH_TOKEN_TTL_MS 
  });

  // Deliberately NOT httpOnly — this is the CSRF double-submit token
  // (see CsrfGuard): client JS reads it from document.cookie and echoes
  // it back as the X-CSRF-Token header on mutating requests.
  res.cookie('csrf_token', randomBytes(16).toString('hex'), { 
    ...baseCookieOptions, 
    httpOnly: false, 
    path: '/', 
    maxAge: REFRESH_TOKEN_TTL_MS 
  });
}

export function clearAuthCookies(res: Response) {
  // Browsers require the exact same path, domain, and sameSite attributes 
  // to successfully remove a cookie.
  res.clearCookie('access_token', { 
    ...baseCookieOptions, 
    path: '/' 
  });
  
  res.clearCookie('refresh_token', { 
    ...baseCookieOptions, 
    path: '/auth' 
  });
  
  res.clearCookie('csrf_token', { 
    ...baseCookieOptions, 
    httpOnly: false, 
    path: '/' 
  });
}