import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { NotificationsModule } from '../notifications/notifications.module';

// Global for the same reason PrismaModule is (see prisma.module.ts):
// JwtAuthGuard is applied via @UseGuards on nearly every controller in the
// app (accounts, properties, documents, vendors, projects, payments,
// listings, materials, ai — everything gated by JwtAuthGuard), and it
// injects JwtService directly. Without @Global() here, every one of those
// feature modules would need to `imports: [AuthModule]` individually just
// to satisfy that one guard's dependency — this is the one-line fix
// instead. (This bug only surfaces once the app actually boots — nest
// build / tsc --noEmit can't catch a DI wiring gap, only Nest's runtime
// dependency resolution can.)
@Global()
@Module({
  imports: [
    NotificationsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // No fallback default on purpose — main.ts's own
        // assertRealJwtSecret() refuses to let the app start listening at
        // all once JWT_SECRET is missing/still the .env.example
        // placeholder, so this only ever runs with a real secret already
        // in process.env by the time a request can reach it. A hardcoded
        // fallback here used to be the actual signing key whenever
        // JWT_SECRET was unset — a real authentication bypass, since that
        // fallback string was published in .env.example.
        secret: config.get<string>('JWT_SECRET'),
        // Unused in practice — AuthService.issueTokenPair always passes an
        // explicit expiresIn per token (1h access / 30d refresh, see that
        // file), this is just a safety-net default for any future
        // `jwt.sign()` call that forgets to.
        signOptions: { expiresIn: '1h' },
      }),
    }),
  ],
  providers: [AuthService],
  controllers: [AuthController],
  exports: [JwtModule],
})
export class AuthModule {}
