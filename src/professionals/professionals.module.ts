import { Module } from '@nestjs/common';
import { ProfessionalsController } from './professionals.controller';
import { ProfessionalsService } from './professionals.service';
import { ProfessionalAuthGuard } from './guards/professional-auth.guard';

/**
 * The job-seeking side of vacancies.reserva.am.
 *
 * A third principal alongside tenant users and platform staff, kept in its own
 * module for the same reason PlatformModule exists: routes are @Public()
 * (skipping the global tenant JwtAuthGuard) and protected by
 * ProfessionalAuthGuard, which verifies a distinct 'professional-access' token
 * type. Nothing here is tenant-scoped and nothing here can reach a partner's
 * data.
 */
@Module({
  controllers: [ProfessionalsController],
  providers: [ProfessionalsService, ProfessionalAuthGuard],
  exports: [ProfessionalsService],
})
export class ProfessionalsModule {}
