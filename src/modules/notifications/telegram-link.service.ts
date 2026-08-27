import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { TelegramService } from './telegram.service';

const LINK_TTL_MS = 24 * 60 * 60 * 1000; // 24h to press Start

/**
 * Issues + consumes the single-use tokens that bind a Telegram chat to a client.
 * Flow: booking confirmation calls `createForBooking` → customer taps the deep
 * link → presses Start → Telegram hits the webhook → `consume` binds the chatId.
 */
@Injectable()
export class TelegramLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  /** Create a connect link for the customer behind a (public) booking. */
  async createForBooking(bookingId: string): Promise<{ url: string } | null> {
    if (!this.telegram.enabled) return null;

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, clientId: true, client: { select: { telegramChatId: true } } },
    });
    if (!booking) throw AppException.notFound('Booking not found');
    // A walk-in entered without a phone has no client row to bind a chat to.
    // (Public bookings always have one — this only guards the nullable column.)
    if (!booking.clientId) return null;
    // Already connected → no link needed.
    if (booking.client?.telegramChatId) return null;

    const token = randomBytes(9).toString('base64url'); // ~12 chars, URL-safe
    await this.prisma.telegramLink.create({
      data: {
        token,
        clientId: booking.clientId,
        bookingId: booking.id,
        expiresAt: new Date(Date.now() + LINK_TTL_MS),
      },
    });
    return { url: this.telegram.connectLink(token) };
  }

  /**
   * Consume a /start token: bind the chatId to the client. Idempotent + safe on
   * bad/expired tokens (returns a friendly result for the welcome message).
   */
  async consume(token: string, chatId: string): Promise<{ ok: boolean; salonName?: string }> {
    const link = await this.prisma.telegramLink.findUnique({
      where: { token },
      select: {
        token: true,
        clientId: true,
        consumedAt: true,
        expiresAt: true,
        client: { select: { partner: { select: { name: true } } } },
      },
    });
    if (!link) return { ok: false };
    if (link.expiresAt < new Date()) return { ok: false };

    await this.prisma.$transaction([
      this.prisma.client.update({
        where: { id: link.clientId },
        data: { telegramChatId: chatId },
      }),
      this.prisma.telegramLink.update({
        where: { token: link.token },
        data: { consumedAt: link.consumedAt ?? new Date() },
      }),
    ]);

    return { ok: true, salonName: link.client.partner.name };
  }
}
