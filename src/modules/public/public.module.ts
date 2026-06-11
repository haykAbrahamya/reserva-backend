import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { SalonsController } from './salons.controller';
import { PublicBookingService } from './public-booking.service';
import { SalonsService } from './salons.service';
import { BookingsModule } from '@/modules/bookings/bookings.module';
import { PartnersModule } from '@/modules/partners/partners.module';

@Module({
  imports: [BookingsModule, PartnersModule],
  controllers: [PublicController, SalonsController],
  providers: [PublicBookingService, SalonsService],
})
export class PublicModule {}
