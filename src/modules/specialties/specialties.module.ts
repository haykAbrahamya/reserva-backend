import { Global, Module } from '@nestjs/common';
import { SpecialtiesController } from './specialties.controller';
import { SpecialtiesService } from './specialties.service';

/**
 * The platform specialty taxonomy — shared vocabulary rather than one product's
 * domain, which is why it is Global: vacancies validates writes against it
 * today, and services/specialists will read the same rows without every module
 * having to import it explicitly.
 */
@Global()
@Module({
  controllers: [SpecialtiesController],
  providers: [SpecialtiesService],
  exports: [SpecialtiesService],
})
export class SpecialtiesModule {}
