import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicBookingService } from './public-booking.service';
import { BookingsModule } from '@/modules/bookings/bookings.module';
import { PartnersModule } from '@/modules/partners/partners.module';

@Module({
  imports: [BookingsModule, PartnersModule],
  controllers: [PublicController],
  providers: [PublicBookingService],
})
export class PublicModule {}
