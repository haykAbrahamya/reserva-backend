import { Module } from '@nestjs/common';
import { CoursesController } from './courses.controller';
import { CoursesService } from './courses.service';
import { CohortsService } from './cohorts.service';
import { EnrollmentsService } from './enrollments.service';
import { CourseCoverService } from './course-cover.service';
import { NotificationsModule } from '@/modules/notifications/notifications.module';

/**
 * Courses domain — a salon "academy" (courses → runs → members), kept fully
 * decoupled from bookings. Split into focused services (single responsibility):
 *   CoursesService     — course templates (CRUD)
 *   CohortsService     — run lifecycle (a small state machine)
 *   EnrollmentsService — members (capacity-guarded)
 *   CourseCoverService — cover-image processing
 * The service is exported so the public module can reuse enrollment/serialization
 * logic for self-registration.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [CoursesController],
  providers: [CoursesService, CohortsService, EnrollmentsService, CourseCoverService],
  exports: [CoursesService, CohortsService, EnrollmentsService],
})
export class CoursesModule {}
