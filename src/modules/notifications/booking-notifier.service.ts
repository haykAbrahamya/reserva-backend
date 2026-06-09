import { Injectable, Logger } from '@nestjs/common';
import { Prisma, NotificationType } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { newId } from '@/common/ids';
import { PushService } from './push.service';

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
  clientName: string;
  startAt: Date | string;
  service?: { name: string } | null;
  specialist?: { name: string } | null;
}

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
  ) {}

  /** Fire-and-forget entrypoint — safe to call without awaiting.
   *  `actorId` (the user who performed the action) is excluded from recipients. */
  notify(event: BookingEvent, booking: NotifiableBooking, actorId?: string): void {
    this.run(event, booking, actorId).catch((e) =>
      this.logger.warn(`Booking notification failed: ${(e as Error).message}`),
    );
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

    const when = new Date(b.startAt).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
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
