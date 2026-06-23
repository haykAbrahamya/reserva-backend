import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from '@/prisma/prisma.service';
import { newId } from '@/common/ids';

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  /** Relative URL to open on click, e.g. /bookings?focus=<id>. */
  url?: string;
  tag?: string;
}

/**
 * Web Push delivery for backoffice staff. VAPID-authenticated; payloads are
 * encrypted by the web-push lib. Dead subscriptions (404/410) are pruned.
 * All sends are best-effort — callers must never let a push failure break a
 * booking write.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private enabled = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    // VAPID subject must be a URL or a mailto: URI. Auto-prefix a bare email so
    // a plain address in .env (e.g. "me@x.com") never throws "not a valid url".
    let subject = this.config.get<string>('VAPID_SUBJECT') || 'mailto:admin@reserva.am';
    if (!/^(https?:|mailto:)/i.test(subject)) subject = `mailto:${subject}`;
    if (publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.enabled = true;
    } else {
      this.logger.warn('VAPID keys not set — push notifications are disabled.');
    }
  }

  get publicKey(): string {
    return this.config.get<string>('VAPID_PUBLIC_KEY') ?? '';
  }

  /** Upsert a device subscription for a user (idempotent by endpoint). */
  async subscribe(userId: string, sub: PushSubscriptionInput, userAgent = '') {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: {
        id: newId(),
        userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent,
      },
      // Re-point the endpoint to the current user (e.g. shared device re-login).
      update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent },
    });
  }

  async unsubscribe(endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint } });
  }

  /** Send a payload to every subscription of the given users. Best-effort. */
  async notifyUsers(userIds: string[], payload: PushPayload): Promise<void> {
    if (!this.enabled || userIds.length === 0) return;

    const subs = await this.prisma.pushSubscription.findMany({
      where: { userId: { in: userIds } },
    });
    if (subs.length === 0) return;

    const body = JSON.stringify(payload);
    const dead: string[] = [];

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
          );
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          // 404/410 = subscription gone; drop it so we stop trying.
          if (status === 404 || status === 410) dead.push(s.endpoint);
          else this.logger.warn(`Push send failed (${status ?? 'err'}) for ${s.id}`);
        }
      }),
    );

    if (dead.length) {
      await this.prisma.pushSubscription.deleteMany({ where: { endpoint: { in: dead } } });
    }
  }

  // ── Public client push (anonymous, scoped to a single booking) ──

  /** Save/refresh a client's push subscription for a booking (idempotent). */
  async subscribeClient(bookingId: string, sub: PushSubscriptionInput, userAgent = '') {
    await this.prisma.clientPushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: {
        id: newId(),
        bookingId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent,
      },
      // Re-point to this booking (same device re-subscribing for a new booking).
      update: { bookingId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent },
    });
  }

  /** Push a payload to every device subscribed to this booking. Best-effort. */
  async notifyBooking(bookingId: string, payload: PushPayload): Promise<void> {
    if (!this.enabled) return;

    const subs = await this.prisma.clientPushSubscription.findMany({ where: { bookingId } });
    if (subs.length === 0) return;

    const body = JSON.stringify(payload);
    const dead: string[] = [];

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
          );
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) dead.push(s.endpoint);
          else this.logger.warn(`Client push failed (${status ?? 'err'}) for ${s.id}`);
        }
      }),
    );

    if (dead.length) {
      await this.prisma.clientPushSubscription.deleteMany({ where: { endpoint: { in: dead } } });
    }
  }
}
