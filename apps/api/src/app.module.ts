import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { CsrfGuard } from './common/guards/csrf.guard';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AccountsModule } from './accounts/accounts.module';
import { PropertiesModule } from './properties/properties.module';
import { DocumentsModule } from './documents/documents.module';
import { VendorsModule } from './vendors/vendors.module';
import { ProjectsModule } from './projects/projects.module';
import { PaymentsModule } from './payments/payments.module';
import { ListingsModule } from './listings/listings.module';
import { MaterialsModule } from './materials/materials.module';
import { AiModule } from './ai/ai.module';
import { ReportsModule } from './reports/reports.module';
import { IdentityModule } from './identity/identity.module';
import { TenantModule } from './tenant/tenant.module';
import { VisualizationsModule } from './visualizations/visualizations.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Baseline rate limit for every route (100 req/min per IP). Auth's
    // sensitive endpoints (login, register, forgot/reset-password) layer a
    // much tighter @Throttle() on top of this in AuthController.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    // Real background scheduling (ReportsSchedulerService's own @Cron
    // job) — not a fake "frequency" field that nothing ever reads.
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    AccountsModule,
    PropertiesModule,
    DocumentsModule,
    VendorsModule,
    ProjectsModule,
    PaymentsModule,
    ListingsModule,
    MaterialsModule,
    AiModule,
    ReportsModule,
    IdentityModule,
    TenantModule,
    VisualizationsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule {}
