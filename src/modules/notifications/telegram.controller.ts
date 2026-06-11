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
      await this.telegram.sendMessage(
        id,
        '👋 Welcome to <b>Reserva</b>! Book a salon and tap “Get notified on Telegram” to receive your booking updates here.',
      );
      return { ok: true };
    }

    const result = await this.links.consume(token, id);
    if (result.ok) {
      const where = result.salonName ? ` for <b>${escapeHtml(result.salonName)}</b>` : '';
      await this.telegram.sendMessage(
        id,
        `✅ <b>You're connected!</b>\nYou'll get booking updates${where} right here — confirmations, reminders and changes. 💆`,
      );
    } else {
      await this.telegram.sendMessage(
        id,
        '⚠️ This connection link is invalid or has expired. Make a booking and tap “Get notified on Telegram” again to reconnect.',
      );
    }
    return { ok: true };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
