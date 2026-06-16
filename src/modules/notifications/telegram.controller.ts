import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@/auth/decorators';
import type { Env } from '@/config/env.config';
import { TelegramService } from './telegram.service';
import { TelegramLinkService } from './telegram-link.service';

/** Minimal shape of a Telegram webhook update we care about (message + /start). */
interface TelegramUpdate {
  message?: {
    chat?: { id?: number | string };
    text?: string;
  };
}

@ApiTags('Public · Telegram')
@Public()
@Controller('public/telegram')
export class TelegramController {
  constructor(
    private readonly telegram: TelegramService,
    private readonly links: TelegramLinkService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Issue a one-tap connect deep link for a booking's customer. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('connect-link')
  @ApiOperation({ summary: 'Get a Telegram connect link for a booking (customer notifications)' })
  async connectLink(@Body('bookingId') bookingId: string) {
    const res = await this.links.createForBooking(bookingId);
    // null = telegram disabled OR already connected → tell the client there's nothing to show.
    return { url: res?.url ?? null };
  }

  /**
   * Telegram calls this on every incoming message. We only handle `/start
   * <token>` to bind the chat to a client, then reply with a welcome. Always
   * returns 200 so Telegram doesn't retry.
   */
  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Telegram bot webhook (internal)' })
  async webhook(
    @Body() update: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secret?: string,
  ) {
    const expected = this.config.get('TELEGRAM_WEBHOOK_SECRET', { infer: true });
    if (expected && secret !== expected) return { ok: true }; // ignore spoofed calls

    const chatId = update.message?.chat?.id;
    const text = update.message?.text?.trim() ?? '';
    if (!chatId || !text.startsWith('/start')) return { ok: true };

    const token = text.split(/\s+/)[1] ?? '';
    const id = String(chatId);

    if (!token) {
      const welcome =
        `👋 <b>Welcome to Reserva!</b>\n\n` +
        `Reserva is the easiest way to discover salons and book beauty &amp; wellness appointments in Armenia. 💆‍♀️✨\n\n` +
        `To get your booking updates right here in Telegram:\n` +
        `1️⃣ Book at any Reserva salon\n` +
        `2️⃣ Tap <b>“Get notified on Telegram”</b> on the confirmation\n` +
        `3️⃣ You're set — confirmations, reminders &amp; changes land here automatically. 🔔`;
      const buttons = [{ text: '🔎 Browse salons', url: 'https://reserva.am/salons' }];
      const image = this.config.get('TELEGRAM_WELCOME_IMAGE', { infer: true });
      // Richer welcome with a banner image when configured; text otherwise.
      if (image) {
        await this.telegram.sendPhoto(id, image, welcome, { buttons });
      } else {
        await this.telegram.sendMessage(id, welcome, { buttons });
      }
      return { ok: true };
    }

    const result = await this.links.consume(token, id);
    if (result.ok) {
      const where = result.salonName ? ` for <b>${escapeHtml(result.salonName)}</b>` : '';
      await this.telegram.sendMessage(
        id,
        `🎉 <b>You're connected!</b>\n\n` +
          `Great — you'll now get updates${where} right here:\n\n` +
          `✅ Booking confirmations\n` +
          `⏰ Friendly reminders before your appointment\n` +
          `🔁 Any reschedules or changes\n\n` +
          `<i>That's it — no app to install, nothing to set up. Enjoy! 🌿</i>`,
      );
    } else {
      await this.telegram.sendMessage(
        id,
        `😕 <b>Hmm, that link didn't work.</b>\n\n` +
          `It may have expired or already been used. No problem — just make a booking and tap ` +
          `<b>“Get notified on Telegram”</b> again to reconnect. 💛`,
      );
    }
    return { ok: true };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
