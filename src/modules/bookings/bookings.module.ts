import { Module } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { ClientsModule } from '@/modules/clients/clients.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';

@Module({
  imports: [ClientsModule, NotificationsModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
