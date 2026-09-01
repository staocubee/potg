import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

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
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'dev-secret-change-me'),
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
