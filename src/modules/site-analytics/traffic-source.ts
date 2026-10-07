/**
 * Where a site session came from, and whether a robot drove it — derived once,
 * on the server, when the session is created (contract §4).
 *
 * The migration that copied the legacy page views
 * (prisma/migrations/20261007120000_site_analytics) applies the same rules in
 * SQL; a change here belongs there too, or old and new sessions will disagree.
 */

/** Values of `site_sessions.channel`. */
export const CHANNELS = [
  'direct',
  'reserva',
  'instagram',
  'facebook',
  'google',
  'search',
  'tiktok',
  'telegram',
  'whatsapp',
  'campaign',
  'other',
] as const;
export type Channel = (typeof CHANNELS)[number];

/** utm_source values with a channel of their own; any other tagged source is a `campaign`. */
const UTM_SOURCE_CHANNELS: Readonly<Record<string, Channel>> = {
  instagram: 'instagram',
  ig: 'instagram',
  facebook: 'facebook',
  fb: 'facebook',
  google: 'google',
  tiktok: 'tiktok',
  telegram: 'telegram',
  tg: 'telegram',
  whatsapp: 'whatsapp',
  wa: 'whatsapp',
};

/**
 * Referrer host → channel, first match wins. `(^|\.)` matches the domain itself
 * or any subdomain (l.instagram.com, m.facebook.com) and never a look-alike
 * (notinstagram.com). The search-engine TLD part allows "am", "com", "co.uk",
 * "com.ua" — and stops "com.google.android.gm" (the Gmail app) counting as
 * Google search.
 */
const REFERRER_CHANNELS: readonly (readonly [RegExp, Channel])[] = [
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)(facebook\.com|fb\.me|fb\.com)$/, 'facebook'],
  [/(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/, 'google'],
  [/(^|\.)(bing|yandex|duckduckgo|yahoo)\.[a-z]{2,3}(\.[a-z]{2})?$/, 'search'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)(t\.me|telegram\.org)$/, 'telegram'],
  [/(^|\.)(wa\.me|whatsapp\.com)$/, 'whatsapp'],
  // Our own pages: the marketplace sent them to a salon, or a session expired
  // mid-visit and the next page started a new one.
  [/(^|\.)reserva\.am$/, 'reserva'],
];

const BOT_USER_AGENT =
  /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|headless|lighthouse|pingdom|monitor|python-requests|curl|wget/i;

/**
 * Hostname of a referrer URL — lower-case, without port or a leading "www." so
 * www.google.com and google.com report as one source. Null when the referrer is
 * empty or not a URL.
 */
export function referrerHostOf(referrer: string | null | undefined): string | null {
  const text = referrer?.trim();
  if (!text) return null;
  try {
    const host = new URL(text).hostname
      .toLowerCase()
      .replace(/\.$/, '')
      .replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

/**
 * The session's acquisition channel:
 *   1. a utm_source tag wins (instagram|ig, facebook|fb, google, tiktok,
 *      telegram|tg, whatsapp|wa; any other tag is a `campaign`);
 *   2. else the referrer's host;
 *   3. else `direct` when there was no referrer, `other` for one we don't know.
 */
export function deriveChannel(
  utmSource: string | null | undefined,
  referrer: string | null | undefined,
): Channel {
  const source = utmSource?.trim().toLowerCase();
  if (source)
    return Object.hasOwn(UTM_SOURCE_CHANNELS, source) ? UTM_SOURCE_CHANNELS[source] : 'campaign';

  if (!referrer?.trim()) return 'direct';
  const host = referrerHostOf(referrer);
  if (!host) return 'other';
  return REFERRER_CHANNELS.find(([pattern]) => pattern.test(host))?.[1] ?? 'other';
}

/** Crawlers, link previews, headless browsers, uptime monitors and scripts. */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  return !!userAgent && BOT_USER_AGENT.test(userAgent);
}
