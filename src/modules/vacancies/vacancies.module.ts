import { Module } from '@nestjs/common';
import { VacanciesController } from './vacancies.controller';
import { VacanciesService } from './vacancies.service';

/**
 * Vacancies — open positions, chair rentals and commission places.
 *
 * Fully decoupled from bookings: it reads Location (organization-level) and the
 * specialty catalog (platform-level) and nothing else, so a partner whose only
 * product is vacancies never touches a Service, Specialist or Booking.
 *
 * The service is exported for the public marketplace module to reuse once the
 * seeker side exists.
 */
@Module({
  controllers: [VacanciesController],
  providers: [VacanciesService],
  exports: [VacanciesService],
})
export class VacanciesModule {}
