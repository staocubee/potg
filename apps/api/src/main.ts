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

  // Security fix: set baseline security headers
  app.use(helmet());

  // Input validation & DTO transformation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.use(cookieParser());

  // Allowed CORS origins list
  const allowedOrigins = [
    'http://localhost:3000',
    'https://www.propertyonthego.com.ng',
    'https://propertyonthego.com.ng',
    'https://api.propertyonthego.com.ng',
    'https://potg.com.ng',
    'https://www.potg.com.ng',
    ...(process.env.WEB_APP_URL
      ? process.env.WEB_APP_URL.split(',').map((url) => url.trim().replace(/\/$/, ''))
      : []),
  ];

  // Dynamic CORS configuration to handle credentialed cookies & preflight OPTIONS
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow server-to-server, mobile app, health checks, or curl requests with no Origin header
      if (!origin) {
        return callback(null, true);
      }

      // Strip trailing slash if present in request origin header
      const normalizedOrigin = origin.replace(/\/$/, '');

      // Regex allows root domain and any subdomains ending with .propertyonthego.com.ng or .potg.com.ng
      const isAllowedDomain = 
        /^https:\/\/(.*\.)?propertyonthego\.com\.ng$/.test(normalizedOrigin) ||
        /^https:\/\/(.*\.)?potg\.com\.ng$/.test(normalizedOrigin) ||
        normalizedOrigin === 'http://localhost:3000';

      if (isAllowedDomain) {
        return callback(null, true);
      }

      return callback(new Error(`CORS policy error: Origin ${origin} is not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Cookie','x-csrf-token', // Add your CSRF header key here
  'X-CSRF-Token'],
  });

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');

  // eslint-disable-next-line no-console
  console.log(`PropertyOnTheGo API listening on :${port}`);
}

bootstrap();