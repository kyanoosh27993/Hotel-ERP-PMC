import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { PermissionsGuard } from './iam/permissions.guard';
import { OutboxModule } from './outbox/outbox.module';
import { AccountingModule } from './accounting/accounting.module';
import { ReservationsModule } from './reservations/reservations.module';
import { PosModule } from './pos/pos.module';
import { PayrollModule } from './payroll/payroll.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { PmsModule } from './pms/pms.module';
import { TreasuryModule } from './treasury/treasury.module';
import { HousekeepingModule } from './housekeeping/housekeeping.module';
import { AssetsModule } from './assets/assets.module';
import { AncillaryModule } from './ancillary/ancillary.module';
import { RestaurantModule } from './restaurant/restaurant.module';
import { ProcurementModule } from './procurement/procurement.module';
import { ComplianceModule } from './compliance/compliance.module';
import { StoresModule } from './stores/stores.module';
import { WorkflowModule } from './workflow/workflow.module';
import { BiModule } from './bi/bi.module';
import { MarketplaceModule } from './marketplace/marketplace.controller';
import { PartiesModule } from './parties/parties.module';
import { AdminModule } from './admin/admin.module';
import { IntegrationHubService, AttendanceSimAdapter } from './integration/integration-hub.service';
import { IntegrationController } from './integration/integration.controller';
import { HealthController } from './health/health.controller';
import { MetricsController } from './health/metrics.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [] }),
    ThrottlerModule.forRoot([{ limit: 300, ttl: 60_000 }]),
    PrismaModule,
    AuthModule,
    OutboxModule,
    AccountingModule,
    ReservationsModule,
    PosModule,
    PayrollModule,
    DashboardModule,
    PmsModule,
    TreasuryModule,
    HousekeepingModule,
    AssetsModule,
    AncillaryModule,
    RestaurantModule,
    StoresModule,
    ProcurementModule,
    ComplianceModule,
    WorkflowModule,
    BiModule,
    MarketplaceModule,
    PartiesModule,
    AdminModule,
  ],
  controllers: [HealthController, MetricsController, IntegrationController],
  providers: [
    AttendanceSimAdapter,
    IntegrationHubService,
    // ترتیب گاردها: ابتدا احراز هویت سپس مجوز
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    {
      provide: 'HUB_BOOTSTRAP',
      useFactory: (hub: IntegrationHubService, sim: AttendanceSimAdapter) => {
        hub.register(sim);
        return true;
      },
      inject: [IntegrationHubService, AttendanceSimAdapter],
    },
  ],
})
export class AppModule {}
