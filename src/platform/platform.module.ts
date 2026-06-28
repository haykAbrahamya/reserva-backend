import { Module } from '@nestjs/common';
import { PlatformAuthController } from './auth/platform-auth.controller';
import { PlatformAuthService } from './auth/platform-auth.service';
import { PlatformPartnersController } from './partners/platform-partners.controller';
import { PlatformPartnersService } from './partners/platform-partners.service';
import { PlatformStaffController } from './staff/platform-staff.controller';
import { PlatformStaffService } from './staff/platform-staff.service';
import { PlatformStatsController } from './stats/platform-stats.controller';
import { PlatformStatsService } from './stats/platform-stats.service';
import { PlatformDemoRequestsController } from './demo-requests/platform-demo-requests.controller';
import { DemoRequestsModule } from '@/modules/demo-requests/demo-requests.module';
import { PlatformPendingRegistrationsController } from './pending-registrations/platform-pending-registrations.controller';
import { PlatformPendingRegistrationsService } from './pending-registrations/platform-pending-registrations.service';
import { PlatformAnalyticsController } from './analytics/platform-analytics.controller';
import { AnalyticsModule } from '@/modules/analytics/analytics.module';
import { PlatformAuthGuard } from './guards/platform-auth.guard';
import { PlatformRolesGuard } from './guards/platform-roles.guard';

/**
 * Internal-backoffice surface: platform staff auth + cross-tenant partner
 * administration. Entirely separate from the tenant-scoped modules. Routes are
 * @Public() (skipping the global tenant JwtAuthGuard) and protected by
 * PlatformAuthGuard, which verifies a distinct 'platform-access' token type.
 */
@Module({
  imports: [DemoRequestsModule, AnalyticsModule],
  controllers: [
    PlatformAuthController,
    PlatformPartnersController,
    PlatformStaffController,
    PlatformStatsController,
    PlatformDemoRequestsController,
    PlatformPendingRegistrationsController,
    PlatformAnalyticsController,
  ],
  providers: [
    PlatformAuthService,
    PlatformPartnersService,
    PlatformStaffService,
    PlatformStatsService,
    PlatformPendingRegistrationsService,
    PlatformAuthGuard,
    PlatformRolesGuard,
  ],
})
export class PlatformModule {}
