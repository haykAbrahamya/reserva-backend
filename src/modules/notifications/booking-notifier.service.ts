import { Injectable, Logger } from '@nestjs/common';
import { Prisma, NotificationType } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { newId } from '@/common/ids';
import { PushService } from './push.service';
import { TelegramService } from './telegram.service';

export type BookingEvent =
  | 'created'
  | 'rescheduled'
  | 'cancelled'
  | 'confirmed'
  | 'completed'
  | 'noshow';

/** Minimal shape we need off a booking row (BOOKING_INCLUDE provides these). */
interface NotifiableBooking {
  id: string;
  partnerId: string;
  locationId: string;
  clientId?: string | null;
  clientName: string;
  startAt: Date | string;
  service?: { name: string } | null;
  specialist?: { name: string } | null;
}

/** Customer-facing message per event (the salon name is prepended). Events the
 *  customer shouldn't be bothered with (e.g. internal "no-show") are omitted. */
const CUSTOMER_MESSAGES: Partial<Record<BookingEvent, (when: string, svc: string, sp: string) => string>> = {
  created: (when, svc, sp) =>
    `📋 <b>Booking received!</b>\n\n` +
    `We've got your request — give us a moment to confirm it. ✨\n\n` +
    `💇 <b>${svc}</b>${sp}\n` +
    `🗓 ${when}\n\n` +
    `<i>We'll ping you the second it's confirmed.</i>`,
  confirmed: (when, svc, sp) =>
    `✅ <b>You're all set!</b>\n\n` +
    `Your appointment is confirmed. We can't wait to see you! 💆\n\n` +
    `💇 <b>${svc}</b>${sp}\n` +
    `🗓 ${when}\n\n` +
    `<i>See you soon — and feel free to arrive a few minutes early. 🌿</i>`,
  rescheduled: (when, svc, sp) =>
    `🔁 <b>Your appointment was moved</b>\n\n` +
    `No worries — here's your new time:\n\n` +
    `💇 <b>${svc}</b>${sp}\n` +
    `🗓 <b>${when}</b>\n\n` +
    `<i>See you then! 💛</i>`,
  cancelled: (when, svc) =>
    `❌ <b>Booking cancelled</b>\n\n` +
    `Your appointment below has been cancelled:\n\n` +
    `💇 ${svc}\n` +
    `🗓 ${when}\n\n` +
    `<i>We'd love to see you another time — book again whenever you're ready. 🌸</i>`,
};

const EVENT_TO_TYPE: Record<BookingEvent, NotificationType> = {
  created: 'booking_created',
  rescheduled: 'booking_rescheduled',
  cancelled: 'booking_cancelled',
  confirmed: 'booking_confirmed',
  completed: 'booking_completed',
  noshow: 'booking_noshow',
};

const EVENT_TITLES: Record<BookingEvent, string> = {
  created: 'New booking',
  rescheduled: 'Booking rescheduled',
  cancelled: 'Booking cancelled',
  confirmed: 'Booking confirmed',
  completed: 'Booking completed',
  noshow: 'Marked no-show',
};

/**
 * Turns booking writes into (1) persisted per-user in-app notifications and
 * (2) best-effort web push, for the right backoffice staff: partner admins
 * (all bookings) + managers scoped to the booking's location. The acting user
 * is skipped (you don't get notified about your own action). Entirely
 * fire-and-forget — never throws into the caller.
 */
@Injectable()
export class BookingNotifier {
  private readonly logger = new Logger(BookingNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
    private readonly telegram: TelegramService,
  ) {}

  /** Fire-and-forget entrypoint — safe to call without awaiting.
   *  `actorId` (the user who performed the action) is excluded from recipients. */
  notify(event: BookingEvent, booking: NotifiableBooking, actorId?: string): void {
    this.run(event, booking, actorId).catch((e) =>
      this.logger.warn(`Booking notification failed: ${(e as Error).message}`),
    );
    // Customer Telegram notification runs independently (separate failure domain).
    this.notifyCustomer(event, booking).catch((e) =>
      this.logger.warn(`Customer telegram notification failed: ${(e as Error).message}`),
    );
  }

  /** Notify the booking's CUSTOMER over Telegram, if they've connected the bot. */
  private async notifyCustomer(event: BookingEvent, b: NotifiableBooking): Promise<void> {
    if (!this.telegram.enabled || !b.clientId) return;
    const template = CUSTOMER_MESSAGES[event];
    if (!template) return; // event not surfaced to customers

    const client = await this.prisma.client.findUnique({
      where: { id: b.clientId },
      select: { telegramChatId: true, partner: { select: { name: true } } },
    });
    if (!client?.telegramChatId) return; // not connected — nothing to do

    const when = formatWhen(b.startAt);
    const svc = b.service?.name ?? 'appointment';
    const sp = b.specialist?.name ? ` with ${escapeHtml(b.specialist.name)}` : '';
    const body = template(when, escapeHtml(svc), sp);
    // Salon name as a subtle header above the message body.
    const salon = client.partner?.name
      ? `🏛 <b>${escapeHtml(client.partner.name)}</b>\n\n`
      : '';
    const html = salon + body;

    const res = await this.telegram.sendMessage(client.telegramChatId, html);
    // If the customer blocked the bot / chat is gone, forget the stale id.
    if (res.unreachable) {
      await this.prisma.client
        .update({ where: { id: b.clientId }, data: { telegramChatId: null } })
        .catch(() => {});
    }
  }

  private async run(event: BookingEvent, b: NotifiableBooking, actorId?: string): Promise<void> {
    const recipients = await this.prisma.user.findMany({
      where: {
        partnerId: b.partnerId,
        active: true,
        deletedAt: null,
        ...(actorId ? { id: { not: actorId } } : {}),
        OR: [{ role: 'admin' }, { role: 'manager', locationId: b.locationId }],
      },
      select: { id: true },
    });
    if (recipients.length === 0) return;

    const when = formatWhen(b.startAt);
    const svc = b.service?.name ?? 'appointment';
    const withSp = b.specialist?.name ? ` with ${b.specialist.name}` : '';
    const title = EVENT_TITLES[event];
    const body = `${b.clientName} · ${svc}${withSp} · ${when}`;
    const userIds = recipients.map((r) => r.id);

    // 1) Persist one notification per recipient (source of truth for the bell).
    const data: Prisma.InputJsonValue = {
      bookingId: b.id,
      clientName: b.clientName,
      service: svc,
      specialist: b.specialist?.name ?? null,
      startAt: new Date(b.startAt).toISOString(),
    };
    await this.prisma.notification.createMany({
      data: userIds.map((userId) => ({
        id: newId(),
        userId,
        partnerId: b.partnerId,
        type: EVENT_TO_TYPE[event],
        title,
        body,
        data,
      })),
    });

    // 2) Transient push nudge (best-effort; prunes dead subs internally).
    await this.push.notifyUsers(userIds, {
      title,
      body,
      url: `/bookings?focus=${b.id}`,
      tag: `booking-${b.id}`,
    });
  }
}

function formatWhen(startAt: Date | string): string {
  return new Date(startAt).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
