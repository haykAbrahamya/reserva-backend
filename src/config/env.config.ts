import { z } from 'zod';

/**
 * Environment schema — validated once at boot. A missing/invalid var fails fast
 * with a clear message instead of surfacing as a confusing runtime error.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),

  /**
   * Base domain whose subdomains are allowed by CORS. With "reserva.am" this
   * permits the apex plus any tenant subdomain (antheris.reserva.am, etc.) over
   * https — so the multi-tenant client doesn't need every slug listed.
   */
  CORS_BASE_DOMAIN: z.string().default(''),

  DATABASE_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  /** Shared secret for internal-backoffice → partner provisioning endpoints. */
  INTERNAL_API_KEY: z.string().min(16),

  /** Telegram bot for free customer booking notifications. If TOKEN is unset,
   *  Telegram notifications self-disable (no-op). USERNAME (without @) builds the
   *  t.me deep link; SECRET guards the webhook endpoint. */
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_BOT_USERNAME: z.string().default('ReservaBookingBot'),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(''),
  /** Optional public image URL shown as a banner in the bot's welcome message.
   *  Empty → welcome is sent as text only. */
  TELEGRAM_WELCOME_IMAGE: z.string().default(''),

  /** Web Push (VAPID). Optional — if unset, push notifications self-disable. */
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:abrahamyan.hayk.03@gmail.com'),

  /** SMTP (Gmail) for transactional email. If unset, mail self-disables (logs). */
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_USER: z.string().default(''),
  /** Gmail App Password (not the account password). */
  SMTP_PASS: z.string().default(''),
  MAIL_FROM: z.string().default('Reserva <reserva.platform@gmail.com>'),

  /** Backoffice base URL — used to build the signup activation magic link. */
  BACKOFFICE_URL: z.string().default('https://backoffice.reserva.am'),

  /**
   * Where uploaded partner images (gallery photos) are written on disk. Served
   * back as static files under /uploads. Default is a repo-local folder for dev;
   * in prod point it at a persistent path (e.g. /var/www/reserva/uploads) that
   * nginx also serves directly.
   */
  UPLOADS_DIR: z.string().default('uploads'),
  /**
   * Public base URL that maps to UPLOADS_DIR (no trailing slash). Stored image
   * URLs are built as `${UPLOADS_PUBLIC_URL}/<partnerId>/<file>`. In prod set to
   * e.g. https://api.reserva.am/uploads. Empty → same-origin "/uploads".
   */
  UPLOADS_PUBLIC_URL: z.string().default(''),

  /** Sentry error monitoring. Empty DSN → Sentry self-disables (dev/local). */
  SENTRY_DSN: z.string().default(''),
  SENTRY_ENV: z.string().default('production'),

  THROTTLE_TTL: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
