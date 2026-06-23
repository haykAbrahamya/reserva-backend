import { Module } from '@nestjs/common';
import { PushService } from './push.service';
import { BookingNotifier } from './booking-notifier.service';
import { NotificationsService } from './notifications.service';
import { TelegramService } from './telegram.service';
import { TelegramLinkService } from './telegram-link.service';
import { PushController } from './push.controller';
import { ClientPushController } from './client-push.controller';
import { NotificationsController } from './notifications.controller';
import { TelegramController } from './telegram.controller';

/**
 * Notifications subsystem:
 * - PushService = web-push transport (staff).
 * - TelegramService/LinkService/Controller = free customer notifications over
 *   Telegram (deep-link /start binding + sendMessage).
 * - BookingNotifier = domain layer; persists per-user notifications + pushes
 *   (staff) and messages the customer over Telegram. Called by BookingsModule.
 * - NotificationsService/Controller = the in-app feed (bell) API.
 */
@Module({
  controllers: [PushController, ClientPushController, NotificationsController, TelegramController],
  providers: [
    PushService,
    BookingNotifier,
    NotificationsService,
    TelegramService,
    TelegramLinkService,
  ],
  exports: [PushService, BookingNotifier, TelegramService],
})
export class NotificationsModule {}
