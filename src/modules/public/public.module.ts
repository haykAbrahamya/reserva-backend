import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { SalonsController } from './salons.controller';
import { PublicBookingService } from './public-booking.service';
import { PublicCoursesService } from './public-courses.service';
import { SalonsService } from './salons.service';
import { BookingsModule } from '@/modules/bookings/bookings.module';
import { PartnersModule } from '@/modules/partners/partners.module';
import { CoursesModule } from '@/modules/courses/courses.module';

@Module({
  imports: [BookingsModule, PartnersModule, CoursesModule],
  controllers: [PublicController, SalonsController],
  providers: [PublicBookingService, PublicCoursesService, SalonsService],
})
export class PublicModule {}
