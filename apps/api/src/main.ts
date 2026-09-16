import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

// Security fix: JwtModule's own factory (auth.module.ts) used to fall
// back to a hardcoded default ('dev-secret-change-me', also published in
// .env.example) whenever JWT_SECRET was unset — meaning a deployment that
// forgot to set it would silently sign and verify every auth token with a
// secret anyone can read in this repo, a complete authentication bypass.
// Checked once, here, before the app (and its port) ever comes up, so a
// misconfigured deployment fails loudly at boot instead of running
// insecurely. Local dev sets a real JWT_SECRET in .env; this only trips if
// that's missing or was copied verbatim from .env.example without
// changing it.
function assertRealJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'dev-secret-change-me') {
    throw new Error(
      'JWT_SECRET is missing or still set to the placeholder value from .env.example. ' +
        'Set a real, random JWT_SECRET (e.g. `node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"`) before starting the API.',
    );
  }
}

async function bootstrap() {
  // Deliberately after NestFactory.create, not before: ConfigModule (see
  // app.module.ts) is what actually loads .env into process.env, as part
  // of resolving AppModule — checking any earlier would see an empty
  // process.env.JWT_SECRET even when .env has a real one set.
  const app = await NestFactory.create(AppModule);
  assertRealJwtSecret();
  // Security fix: no security headers were set anywhere (no CSP,
  // X-Content-Type-Options, X-Frame-Options, HSTS, and Express's default
  // X-Powered-By was still leaking the framework). helmet()'s defaults are
  // the standard NestJS-recommended baseline — safe for a pure JSON API,
  // no impact on normal request/response handling.
  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.use(cookieParser());
  // Auth now lives in httpOnly cookies (see src/auth/cookie.util.ts), so
  // this can no longer be the permissive `enableCors()` default: a
  // wildcard `Access-Control-Allow-Origin` is incompatible with
  // credentialed requests by spec, and the browser would silently refuse
  // to send/receive cookies cross-origin. An explicit origin plus
  // `credentials: true` is what actually lets the cookie round-trip.
  app.enableCors({ origin: process.env.WEB_APP_URL ?? 'http://localhost:3000', credentials: true });
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`PropertyOnTheGo API listening on :${port}`);
}

bootstrap();
