import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
