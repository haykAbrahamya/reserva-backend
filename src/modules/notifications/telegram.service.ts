import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@/config/env.config';

/**
 * Thin Telegram Bot API client for free customer notifications. Self-disables
 * when TELEGRAM_BOT_TOKEN is unset (every method becomes a safe no-op), so the
 * feature can ship before the token is configured.
 *
 * Telegram bots can only message a user AFTER that user presses Start — so the
 * connection (deep-link /start → bind chatId) happens elsewhere; this service
 * just sends to an already-bound chatId.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly token: string;
  readonly username: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.token = this.config.get('TELEGRAM_BOT_TOKEN', { infer: true });
    this.username = this.config.get('TELEGRAM_BOT_USERNAME', { infer: true });
  }

  get enabled(): boolean {
    return this.token.length > 0;
  }

  /** Build the one-tap connect link: t.me/<bot>?start=<token>. */
  connectLink(startToken: string): string {
    return `https://t.me/${this.username}?start=${encodeURIComponent(startToken)}`;
  }

  private api(method: string) {
    return `https://api.telegram.org/bot${this.token}/${method}`;
  }

  /**
   * Send an HTML message to a chat. Returns true on success. Detects "blocked /
   * chat not found" (403/400) so the caller can mark the chat unreachable.
   */
  async sendMessage(
    chatId: string,
    html: string,
    opts: { buttons?: { text: string; url: string }[] } = {},
  ): Promise<{ ok: boolean; unreachable?: boolean }> {
    if (!this.enabled) return { ok: false };
    try {
      const reply_markup = opts.buttons?.length
        ? { inline_keyboard: [opts.buttons.map((b) => ({ text: b.text, url: b.url }))] }
        : undefined;

      const res = await fetch(this.api('sendMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: html,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup,
        }),
      });
      if (res.ok) return { ok: true };

      const body = (await res.json().catch(() => null)) as { description?: string } | null;
      const desc = body?.description ?? '';
      // 403 = bot blocked by user; "chat not found" = stale id.
      const unreachable = res.status === 403 || /chat not found|blocked/i.test(desc);
      this.logger.warn(`Telegram sendMessage failed (${res.status}): ${desc}`);
      return { ok: false, unreachable };
    } catch (e) {
      this.logger.warn(`Telegram sendMessage error: ${(e as Error).message}`);
      return { ok: false };
    }
  }

  /**
   * Send a photo (by public URL) with an optional HTML caption + buttons. Used
   * for a richer welcome. Falls back silently when disabled.
   */
  async sendPhoto(
    chatId: string,
    photoUrl: string,
    caption: string,
    opts: { buttons?: { text: string; url: string }[] } = {},
  ): Promise<{ ok: boolean; unreachable?: boolean }> {
    if (!this.enabled) return { ok: false };
    try {
      const reply_markup = opts.buttons?.length
        ? { inline_keyboard: [opts.buttons.map((b) => ({ text: b.text, url: b.url }))] }
        : undefined;
      const res = await fetch(this.api('sendPhoto'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo: photoUrl,
          caption,
          parse_mode: 'HTML',
          reply_markup,
        }),
      });
      if (res.ok) return { ok: true };
      const body = (await res.json().catch(() => null)) as { description?: string } | null;
      const desc = body?.description ?? '';
      const unreachable = res.status === 403 || /chat not found|blocked/i.test(desc);
      this.logger.warn(`Telegram sendPhoto failed (${res.status}): ${desc}`);
      return { ok: false, unreachable };
    } catch (e) {
      this.logger.warn(`Telegram sendPhoto error: ${(e as Error).message}`);
      return { ok: false };
    }
  }

  /** Register the webhook URL with Telegram (run once after deploy). */
  async setWebhook(url: string, secretToken?: string): Promise<boolean> {
    if (!this.enabled) return false;
    const res = await fetch(this.api('setWebhook'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        secret_token: secretToken || undefined,
        allowed_updates: ['message'],
      }),
    });
    return res.ok;
  }
}
