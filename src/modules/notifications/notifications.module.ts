import { Module } from '@nestjs/common';
import { PushService } from './push.service';
import { BookingNotifier } from './booking-notifier.service';
import { NotificationsService } from './notifications.service';
import { PushController } from './push.controller';
import { NotificationsController } from './notifications.controller';

/**
 * Notifications subsystem:
 * - PushService = web-push transport.
 * - BookingNotifier = domain layer; persists per-user notifications + pushes.
 *   Called by BookingsModule on booking events.
 * - NotificationsService/Controller = the in-app feed (bell) API.
 * BookingNotifier + PushService are exported for cross-module injection.
 */
@Module({
  controllers: [PushController, NotificationsController],
  providers: [PushService, BookingNotifier, NotificationsService],
  exports: [PushService, BookingNotifier],
})
export class NotificationsModule {}
