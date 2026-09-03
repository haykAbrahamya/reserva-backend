import { Module } from '@nestjs/common';
import { VacanciesController } from './vacancies.controller';
import { VacanciesService } from './vacancies.service';
import { VacancyApplicationsService } from './applications.service';

/**
 * Vacancies — open positions, chair rentals and commission places.
 *
 * Fully decoupled from bookings: it reads Location (organization-level) and the
 * specialty catalog (platform-level) and nothing else, so a partner whose only
 * product is vacancies never touches a Service, Specialist or Booking.
 *
 * The applications service is exported because the PUBLIC board writes through
 * it: one owner of `vacancy_applications` serving both the stranger who applies
 * and the salon that triages, so the phone dialled from the backoffice is
 * normalized by the same function that de-duplicated the applicant.
 */
@Module({
  controllers: [VacanciesController],
  providers: [VacanciesService, VacancyApplicationsService],
  exports: [VacanciesService, VacancyApplicationsService],
})
export class VacanciesModule {}
