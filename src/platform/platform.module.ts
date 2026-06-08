import { Module } from '@nestjs/common';
import { PlatformAuthController } from './auth/platform-auth.controller';
import { PlatformAuthService } from './auth/platform-auth.service';
import { PlatformPartnersController } from './partners/platform-partners.controller';
import { PlatformPartnersService } from './partners/platform-partners.service';
import { PlatformStaffController } from './staff/platform-staff.controller';
import { PlatformStaffService } from './staff/platform-staff.service';
import { PlatformStatsController } from './stats/platform-stats.controller';
import { PlatformStatsService } from './stats/platform-stats.service';
import { PlatformAuthGuard } from './guards/platform-auth.guard';
import { PlatformRolesGuard } from './guards/platform-roles.guard';

/**
 * Internal-backoffice surface: platform staff auth + cross-tenant partner
 * administration. Entirely separate from the tenant-scoped modules. Routes are
 * @Public() (skipping the global tenant JwtAuthGuard) and protected by
 * PlatformAuthGuard, which verifies a distinct 'platform-access' token type.
 */
@Module({
  controllers: [
    PlatformAuthController,
    PlatformPartnersController,
    PlatformStaffController,
    PlatformStatsController,
  ],
  providers: [
    PlatformAuthService,
    PlatformPartnersService,
    PlatformStaffService,
    PlatformStatsService,
    PlatformAuthGuard,
    PlatformRolesGuard,
  ],
})
export class PlatformModule {}
