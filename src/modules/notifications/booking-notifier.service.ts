import { Injectable, Logger } from '@nestjs/common';
import { Prisma, NotificationType } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { newId } from '@/common/ids';
import { displayPersonName } from '@/common/utils/person-name';
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
  /** The branch; named in messages when the partner has more than one. */
  location?: { name: string; address?: string | null } | null;
  /** UI language the booking was made in ('en'|'hy'|'ru'), for localized push. */
  locale?: string | null;
}

type Lang = 'en' | 'hy' | 'ru';

/** Short, plain-text push copy per event, per language (title + body). The
 *  salon name is interpolated; events not meant for customers are omitted. */
const PUSH_COPY: Record<Lang, Partial<Record<BookingEvent, { title: string; body: (salon: string, when: string) => string }>>> = {
  en: {
    confirmed:   { title: 'Booking confirmed ✓',  body: (s, w) => `Your appointment at ${s} is confirmed — ${w}.` },
    rescheduled: { title: 'Booking rescheduled',  body: (s, w) => `Your appointment at ${s} was moved to ${w}.` },
    cancelled:   { title: 'Booking cancelled',    body: (s) => `Your appointment at ${s} was cancelled.` },
  },
  hy: {
    confirmed:   { title: 'Ամրագրումը հաստատվեց ✓', body: (s, w) => `${s}-ի ձեր այցը հաստատված է՝ ${w}։` },
    rescheduled: { title: 'Ամրագրումը տեղափոխվեց',  body: (s, w) => `${s}-ի ձեր այցը տեղափոխվեց՝ ${w}։` },
    cancelled:   { title: 'Ամրագրումը չեղարկվեց',    body: (s) => `${s}-ի ձեր այցը չեղարկվել է։` },
  },
  ru: {
    confirmed:   { title: 'Запись подтверждена ✓', body: (s, w) => `Ваша запись в ${s} подтверждена — ${w}.` },
    rescheduled: { title: 'Запись перенесена',     body: (s, w) => `Ваша запись в ${s} перенесена на ${w}.` },
    cancelled:   { title: 'Запись отменена',       body: (s) => `Ваша запись в ${s} отменена.` },
  },
};

/** Customer-facing message per event (the salon name is prepended). Events the
 *  customer shouldn't be bothered with (e.g. internal "no-show") are omitted.
 *  `place` is a ready "📍 branch" line, or '' for a single-branch salon. */
const CUSTOMER_MESSAGES: Partial<
  Record<BookingEvent, (when: string, svc: string, sp: string, place: string) => string>
> = {
  created: (when, svc, sp, place) =>
    `📋 <b>Booking received!</b>\n\n` +
    `We've got your request — give us a moment to confirm it. ✨\n\n` +
    `💇 <b>${svc}</b>${sp}\n` +
    `🗓 ${when}\n${place}\n` +
    `<i>We'll ping you the second it's confirmed.</i>`,
  confirmed: (when, svc, sp, place) =>
    `✅ <b>You're all set!</b>\n\n` +
    `Your appointment is confirmed. We can't wait to see you! 💆\n\n` +
    `💇 <b>${svc}</b>${sp}\n` +
    `🗓 ${when}\n${place}\n` +
    `<i>See you soon — and feel free to arrive a few minutes early. 🌿</i>`,
  rescheduled: (when, svc, sp, place) =>
    `🔁 <b>Your appointment was moved</b>\n\n` +
    `No worries — here's your new time:\n\n` +
    `💇 <b>${svc}</b>${sp}\n` +
    `🗓 <b>${when}</b>\n${place}\n` +
    `<i>See you then! 💛</i>`,
  cancelled: (when, svc, _sp, place) =>
    `❌ <b>Booking cancelled</b>\n\n` +
    `Your appointment below has been cancelled:\n\n` +
    `💇 ${svc}\n` +
    `🗓 ${when}\n${place}\n` +
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
  notify(
    event: BookingEvent,
    booking: NotifiableBooking,
    actorId?: string,
    /**
     * `skipCustomer` sends to staff only. Used for a BACKDATED booking, where
     * the customer copy would announce an appointment that is already over.
     */
    opts: { skipCustomer?: boolean } = {},
  ): void {
    this.run(event, booking, actorId).catch((e) =>
      this.logger.warn(`Booking notification failed: ${(e as Error).message}`),
    );
    if (opts.skipCustomer) return;
    // Customer Telegram notification runs independently (separate failure domain).
    this.notifyCustomer(event, booking).catch((e) =>
      this.logger.warn(`Customer telegram notification failed: ${(e as Error).message}`),
    );
    // Customer web-push (per-booking subscription) — independent best-effort.
    this.notifyCustomerPush(event, booking).catch((e) =>
      this.logger.warn(`Customer push notification failed: ${(e as Error).message}`),
    );
  }

  /** Push the booking's CUSTOMER device(s) about a status change (if subscribed). */
  private async notifyCustomerPush(event: BookingEvent, b: NotifiableBooking): Promise<void> {
    const lang: Lang = (b.locale === 'hy' || b.locale === 'ru' ? b.locale : 'en');
    const copy = PUSH_COPY[lang][event];
    if (!copy) return; // event not surfaced to customers

    // Resolve the salon name (and locale fallback) without burdening callers.
    const booking = await this.prisma.booking.findUnique({
      where: { id: b.id },
      select: {
        locale: true,
        location: { select: { name: true } },
        partner: { select: { name: true, _count: { select: { locations: { where: { deletedAt: null } } } } } },
      },
    });
    const realLang: Lang =
      booking?.locale === 'hy' || booking?.locale === 'ru' ? booking.locale : lang;
    const c = PUSH_COPY[realLang][event] ?? copy;
    // With several branches, say which one ("Beauty Club · Kentron").
    const branch = (booking?.partner?._count.locations ?? 0) > 1 ? booking?.location?.name : undefined;
    const salon = booking?.partner?.name
      ? branch
        ? `${booking.partner.name} · ${branch}`
        : booking.partner.name
      : 'the salon';
    const when = formatWhen(b.startAt);

    await this.push.notifyBooking(b.id, {
      title: c.title,
      body: c.body(salon, when),
      tag: `booking-${b.id}`,
    });
  }

  /** Notify the booking's CUSTOMER over Telegram, if they've connected the bot. */
  private async notifyCustomer(event: BookingEvent, b: NotifiableBooking): Promise<void> {
    if (!this.telegram.enabled || !b.clientId) return;
    const template = CUSTOMER_MESSAGES[event];
    if (!template) return; // event not surfaced to customers

    const client = await this.prisma.client.findUnique({
      where: { id: b.clientId },
      select: {
        telegramChatId: true,
        partner: {
          select: {
            name: true,
            specialistNamesSurnameFirst: true,
            _count: { select: { locations: { where: { deletedAt: null } } } },
          },
        },
      },
    });
    if (!client?.telegramChatId) return; // not connected — nothing to do

    const when = formatWhen(b.startAt);
    const svc = b.service?.name ?? 'appointment';
    const spName = b.specialist?.name
      ? displayPersonName(b.specialist.name, client.partner?.specialistNamesSurnameFirst)
      : '';
    const sp = spName ? ` with ${escapeHtml(spName)}` : '';
    // A salon with several branches: tell the client which one to go to.
    const multiBranch = (client.partner?._count.locations ?? 0) > 1;
    const place =
      multiBranch && b.location?.name
        ? `📍 ${escapeHtml(b.location.name)}${b.location.address ? ` · ${escapeHtml(b.location.address)}` : ''}\n`
        : '';
    const body = template(when, escapeHtml(svc), sp, place);
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

  /**
   * Fire-and-forget: notify backoffice staff that someone self-registered for a
   * course. Course enrollment is a partner-level event (a run has no location),
   * so recipients are the partner's active ADMINS. Lands in the same bell +
   * web-push channel as bookings, so it needs no new plumbing on the client side
   * beyond an icon + deep-link for the new type.
   */
  notifyEnrollment(input: {
    partnerId: string;
    courseId: string;
    courseTitle: string;
    memberName: string;
  }): void {
    this.runEnrollment(input).catch((e) =>
      this.logger.warn(`Enrollment notification failed: ${(e as Error).message}`),
    );
  }

  private async runEnrollment(input: {
    partnerId: string;
    courseId: string;
    courseTitle: string;
    memberName: string;
  }): Promise<void> {
    const recipients = await this.prisma.user.findMany({
      where: { partnerId: input.partnerId, active: true, deletedAt: null, role: 'admin' },
      select: { id: true },
    });
    if (recipients.length === 0) return;

    const userIds = recipients.map((r) => r.id);
    const title = 'New course registration';
    const body = `${input.memberName} · ${input.courseTitle}`;
    const data: Prisma.InputJsonValue = {
      courseId: input.courseId,
      courseTitle: input.courseTitle,
      memberName: input.memberName,
    };

    await this.prisma.notification.createMany({
      data: userIds.map((userId) => ({
        id: newId(),
        userId,
        partnerId: input.partnerId,
        type: 'course_registration' as NotificationType,
        title,
        body,
        data,
      })),
    });

    await this.push.notifyUsers(userIds, {
      title,
      body,
      url: `/courses?focus=${input.courseId}`,
      tag: `course-${input.courseId}`,
    });
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
    // The specialist as the salon shows names (given name first if they type surname first).
    const partnerPrefs = await this.prisma.partner.findUnique({
      where: { id: b.partnerId },
      select: { specialistNamesSurnameFirst: true },
    });
    const spName = b.specialist?.name
      ? displayPersonName(b.specialist.name, partnerPrefs?.specialistNamesSurnameFirst)
      : null;
    const withSp = spName ? ` with ${spName}` : '';
    // Admins of a multi-branch salon see every branch's bookings: name it.
    const branches = await this.prisma.location.count({ where: { partnerId: b.partnerId, deletedAt: null } });
    const branch = branches > 1 && b.location?.name ? b.location.name : null;
    const title = EVENT_TITLES[event];
    const body = `${b.clientName} · ${svc}${withSp}${branch ? ` · ${branch}` : ''} · ${when}`;
    const userIds = recipients.map((r) => r.id);

    // 1) Persist one notification per recipient (source of truth for the bell).
    const data: Prisma.InputJsonValue = {
      bookingId: b.id,
      clientName: b.clientName,
      service: svc,
      specialist: spName,
      ...(branch ? { location: branch } : {}),
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
