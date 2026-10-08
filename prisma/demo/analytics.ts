/**
 * Demo traffic for the internal console's Analytics section: ~45 days of
 * public-site sessions and events across the demo partners, the marketplace
 * and the sign-up page — what POST /public/pulse would have recorded.
 *
 * Shaped to agree with the rest of the demo rather than merely look busy:
 *   · every public booking in the window gets the visit that made it — a
 *     session ending in booking_success with the booking's own service /
 *     specialist / branch ids, at its createdAt — except the ~10% a real
 *     tracker misses (blockers, closed tabs);
 *   · the rest of a partner's traffic scales with its bookings, so the
 *     console's conversion (booked sessions / sessions that viewed the page,
 *     contract §9) lands around 5%;
 *   · sign-up successes are the pending registrations made on reserva.am;
 *   · every review in the window gets the visit that left it — the form
 *     opened for its specialist, review_success with its own stars, at its
 *     createdAt — again minus the ~10% a tracker misses; a few more visits
 *     read the reviews or open the form and leave without sending;
 *   · every session reads like a real visit in the console's timeline: a
 *     third of browsing visits bounce; a booking visit looks at the category
 *     and specialist it then books; many bookers came 1–3 times on earlier
 *     days before booking; returning visitors keep their device and language
 *     and come back at most 4 times; funnels drop off step by step; contact
 *     clicks depend on where the visitor came from (Instagram → WhatsApp,
 *     Google → call / directions).
 * Mixes follow the brief: instagram 45%, direct 25%, google 15%, facebook 7%,
 * reserva 5%, other 3% (split over the long-tail channels); ~80% mobile;
 * hy / ru / en ≈ 64 / 24 / 12. A few staff and bot sessions exercise the
 * console's filters.
 *
 * Rows are built with the server's own rules — channel from deriveChannel,
 * device / browser / os from parseUserAgent, the bot flag from isBotUserAgent
 * — and every event's props are validated against the contract catalog, so
 * the demo cannot show anything real ingestion would not store.
 *
 * Every id starts with `demo-` (DEMO_ANALYTICS_PREFIX); that is how a re-run
 * finds and replaces them. Deterministic: per-partner PRNG streams, played out
 * in time order, like the rest of the seed.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { parseUserAgent, type ParsedUserAgent } from '../../src/common/utils/visitor';
import { EVENT_PROPS, type SiteEventName } from '../../src/modules/site-analytics/pulse-batch';
import { deriveChannel, isBotUserAgent, referrerHostOf, type Channel } from '../../src/modules/site-analytics/traffic-source';
import { PARTNERS } from './partners';
import { DAY, HOUR, MINUTE, dayStart, rng, type Rng } from './random';

/** Prefix of every session, visitor and event id this module writes. */
export const DEMO_ANALYTICS_PREFIX = 'demo-';

/** Days of history, today included. */
const WINDOW_DAYS = 45;
/**
 * Browsing (non-booking) sessions per day for each public booking per day.
 * With ~90% of bookings tracked, session conversion ≈ 0.9 / (16 + 0.9) ≈ 5%.
 */
const SESSIONS_PER_BOOKING = 16;
/** Partners with few or no online bookings (contact-only, a tiny solo pro) still get looked at. */
const MIN_SESSIONS_PER_DAY: Readonly<Record<string, number>> = { mane: 22, 'davit-barber': 6 };
const DEFAULT_MIN_SESSIONS_PER_DAY = 8;
/** Share of real public bookings whose visit the tracker saw. */
const TRACKED_SHARE = 0.9;
const MARKETPLACE_SESSIONS_PER_DAY = 70;
const SIGNUP_SESSIONS_PER_DAY = 4;
const STAFF_SESSIONS_PER_DAY = 1.6;
const BOT_SESSIONS_PER_DAY = 3;
/** How far back "returning visitor" reaches into a pool (most returns are recent). */
const RETURN_WINDOW = 400;

const APEX = 'reserva.am';

type Props = Record<string, unknown>;

// ══════════════════════════════════════════════════════════════
// Who visits
// ══════════════════════════════════════════════════════════════

/**
 * How NEW visitors arrive (%). Returning visitors come back direct a quarter
 * of the time, so these lean slightly away from `direct` for the SESSION mix
 * to land on the brief: instagram 45, direct 25, google 15, facebook 7,
 * reserva 5, other 3 — the "other" being the long tail, split as the rules
 * would see it.
 */
const CHANNEL_MIX: readonly (readonly [Channel, number])[] = [
  ['instagram', 47.5],
  ['direct', 21],
  ['google', 15.5],
  ['facebook', 7.3],
  ['reserva', 5.2],
  ['other', 1.4],
  ['telegram', 0.6],
  ['tiktok', 0.4],
  ['search', 0.3],
  ['campaign', 0.2],
  ['whatsapp', 0.1],
];

interface Utm {
  source: string;
  medium: string;
  campaign: string;
}

interface Source {
  channel: Channel;
  referrer: string;
  utm: Utm | null;
}

/** A referrer (and sometimes UTM tags) that the server's rules turn back into `channel`. */
function sourceFor(r: Rng, channel: Channel): Source {
  const tagged = (p: number, utm: () => Utm) => (r.chance(p) ? utm() : null);
  switch (channel) {
    case 'instagram':
      return {
        channel,
        referrer: r.weighted([['https://l.instagram.com/', 7], ['https://www.instagram.com/', 3]] as const),
        utm: tagged(0.3, () => ({
          source: r.pick(['instagram', 'ig']),
          medium: r.weighted([['bio', 5], ['story', 3], ['reel', 2]] as const),
          campaign: r.weighted([['autumn-promo', 4], ['october-offer', 3], ['new-masters', 2]] as const),
        })),
      };
    case 'facebook':
      return {
        channel,
        referrer: r.weighted([['https://m.facebook.com/', 45], ['https://l.facebook.com/', 35], ['https://www.facebook.com/', 20]] as const),
        utm: tagged(0.25, () => ({ source: r.pick(['facebook', 'fb']), medium: r.pick(['paid', 'post']), campaign: 'october-offer' })),
      };
    case 'google':
      return {
        channel,
        referrer: r.weighted([['https://www.google.com/', 70], ['https://www.google.am/', 22], ['https://www.google.ru/', 8]] as const),
        utm: tagged(0.15, () => ({ source: 'google', medium: 'cpc', campaign: r.pick(['brand-search', 'laser-yerevan']) })),
      };
    case 'reserva':
      // Arrived on a salon's own subdomain from the marketplace.
      return { channel, referrer: r.weighted([['https://reserva.am/salons', 7], ['https://reserva.am/', 3]] as const), utm: null };
    case 'other':
      return {
        channel,
        referrer: r.weighted([
          ['https://linktr.ee/', 30],
          ['https://www.spyur.am/', 25],
          ['https://chatgpt.com/', 20],
          ['https://www.list.am/', 15],
          ['https://maps.app.goo.gl/', 10],
        ] as const),
        utm: null,
      };
    case 'telegram':
      return { channel, referrer: r.pick(['https://t.me/', 'https://web.telegram.org/']), utm: null };
    case 'tiktok':
      return { channel, referrer: 'https://www.tiktok.com/', utm: null };
    case 'search':
      return { channel, referrer: r.pick(['https://yandex.ru/', 'https://www.bing.com/']), utm: null };
    case 'whatsapp':
      return { channel, referrer: 'https://web.whatsapp.com/', utm: null };
    case 'campaign':
      return { channel, referrer: '', utm: { source: 'newsletter', medium: 'email', campaign: 'october-digest' } };
    case 'direct':
      return { channel, referrer: '', utm: null };
  }
}

interface Device {
  ua: string;
  w: number;
  h: number;
}

const DEVICES = {
  iosSafari: { w: 390, h: 844, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1' },
  iosSafariMax: { w: 430, h: 932, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' },
  instagramIos: { w: 393, h: 852, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22G86 Instagram 389.0.0.29.81 (iPhone15,2; iOS 18_6; hy_AM; hy; scale=3.00; 1179x2556; 773312156)' },
  instagramAndroid: { w: 384, h: 832, ua: 'Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.7339.207 Mobile Safari/537.36 Instagram 389.0.0.29.81 Android (34/14; 450dpi; 1080x2340; samsung; SM-A546B; a54x; s5e8835; hy_AM; 773312156)' },
  facebookIos: { w: 390, h: 844, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22G86 [FBAN/FBIOS;FBAV/495.0.0.45.110;FBBV/712345678;FBDV/iPhone14,7;FBMD/iPhone;FBSN/iOS;FBSV/18.6;FBSS/3;FBID/phone;FBLC/hy_AM;FBOP/5]' },
  androidChrome: { w: 412, h: 915, ua: 'Mozilla/5.0 (Linux; Android 15; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.207 Mobile Safari/537.36' },
  samsung: { w: 384, h: 854, ua: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36' },
  winChrome: { w: 1920, h: 1080, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' },
  winEdge: { w: 1536, h: 864, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0' },
  macSafari: { w: 1440, h: 900, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15' },
  macChrome: { w: 1512, h: 982, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' },
  winFirefox: { w: 2560, h: 1440, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0' },
  ipad: { w: 820, h: 1180, ua: 'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1' },
  androidTablet: { w: 800, h: 1280, ua: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.207 Safari/537.36' },
} satisfies Record<string, Device>;

const BOT_DEVICES: readonly Device[] = [
  { w: 412, h: 732, ua: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.207 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
  { w: 1366, h: 768, ua: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)' },
  { w: 1024, h: 768, ua: 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)' },
  { w: 800, h: 600, ua: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' },
  { w: 1920, h: 1080, ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36' },
  { w: 1366, h: 768, ua: 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)' },
];

/** Share of each channel's sessions on a phone (tablets are a flat 3% on top). */
const MOBILE_SHARE: Partial<Record<Channel, number>> = { instagram: 0.93, facebook: 0.9, tiktok: 0.95, telegram: 0.85, google: 0.62, direct: 0.7 };

function deviceFor(r: Rng, channel: Channel): Device {
  const mobile = MOBILE_SHARE[channel] ?? 0.68;
  const roll = r.next();
  if (roll < mobile) {
    // In-app browsers: a link tapped inside Instagram / Facebook opens there.
    if (channel === 'instagram' && r.chance(0.58)) return r.chance(0.62) ? DEVICES.instagramIos : DEVICES.instagramAndroid;
    if (channel === 'facebook' && r.chance(0.45)) return DEVICES.facebookIos;
    return r.weighted([
      [DEVICES.iosSafari, 38],
      [DEVICES.iosSafariMax, 12],
      [DEVICES.androidChrome, 33],
      [DEVICES.samsung, 17],
    ] as const);
  }
  if (roll < mobile + 0.03) return r.weighted([[DEVICES.ipad, 3], [DEVICES.androidTablet, 1]] as const);
  return r.weighted([
    [DEVICES.winChrome, 45],
    [DEVICES.macSafari, 18],
    [DEVICES.macChrome, 15],
    [DEVICES.winEdge, 14],
    [DEVICES.winFirefox, 8],
  ] as const);
}

/** navigator.language values; hy / ru / en ≈ 64 / 24 / 12. */
const LANGUAGES: readonly (readonly [string, number])[] = [
  ['hy-AM', 55],
  ['hy', 9],
  ['ru-RU', 17],
  ['ru', 5],
  ['ru-AM', 2],
  ['en-US', 9],
  ['en-GB', 3],
];

interface Place {
  country: string | null;
  city: string | null;
}

const place = (country: string | null, city: string | null = null): Place => ({ country, city });

/** Where a visitor is, given the language their browser speaks. */
const PLACES: Record<'hy' | 'ru' | 'en', readonly (readonly [Place, number])[]> = {
  hy: [
    [place('AM', 'Yerevan'), 70], [place('AM', 'Gyumri'), 6], [place('AM', 'Vanadzor'), 4], [place('AM', 'Abovyan'), 2],
    [place('AM', 'Vagharshapat'), 2], [place('AM'), 6], [place('US', 'Glendale'), 3], [place('US', 'Los Angeles'), 2],
    [place('RU', 'Moscow'), 2], [place('FR', 'Paris'), 1], [place(null), 2],
  ],
  ru: [
    [place('AM', 'Yerevan'), 58], [place('AM', 'Gyumri'), 4], [place('AM'), 4], [place('RU', 'Moscow'), 16],
    [place('RU', 'Saint Petersburg'), 5], [place('RU', 'Krasnodar'), 4], [place('GE', 'Tbilisi'), 4], [place(null), 5],
  ],
  en: [
    [place('AM', 'Yerevan'), 52], [place('AM'), 4], [place('US', 'Glendale'), 9], [place('US', 'Los Angeles'), 6],
    [place('GB', 'London'), 6], [place('FR', 'Paris'), 5], [place('AE', 'Dubai'), 6], [place('DE', 'Berlin'), 4], [place(null), 8],
  ],
};

/** One browser, as the tracker knows it: its own id, device and language for good. */
interface Visitor {
  id: string;
  device: Device;
  language: string;
  place: Place;
  /** How they first arrived; in-app browsers can only come back the same way. */
  channel: Channel;
  /** Sessions written for them so far (a returning visitor has 2–4). */
  visits: number;
}

/** Nobody in the demo comes back more often than this. */
const MAX_VISITS_PER_VISITOR = 4;

const primaryLanguage = (tag: string) => tag.slice(0, 2) as 'hy' | 'ru' | 'en';

// ══════════════════════════════════════════════════════════════
// Where they go
// ══════════════════════════════════════════════════════════════

interface ServiceInfo {
  id: string;
  name: string;
  category: string;
  requiresSpecialist: boolean;
}

interface BookingInfo {
  createdAt: Date;
  serviceId: string;
  specialistId: string | null;
  locationId: string;
  locale: string | null;
}

interface ReviewInfo {
  createdAt: Date;
  specialistId: string;
  rating: number;
}

interface PartnerInfo {
  id: string;
  slug: string;
  bookingsEnabled: boolean;
  /** A solo pro: the reviews sit on the page itself, not with a team member. */
  single: boolean;
  /** The tabbed template, which has a Reviews tab. */
  tabbed: boolean;
  /** The page shows a rating at all (it has reviews). */
  hasReviews: boolean;
  listed: boolean;
  locations: string[];
  services: ServiceInfo[];
  categories: string[];
  specialists: string[];
  courses: string[];
  bookings: BookingInfo[];
  reviews: ReviewInfo[];
  /** Visitors of the partner's own subdomain (localStorage is per origin). */
  pool: Visitor[];
}

interface Page {
  host: string;
  path: string;
  partnerId: string | null;
}

const apexPage = (path: string): Page => ({ host: APEX, path, partnerId: null });
/** A salon's page: its own subdomain, or /p/<slug> on the apex (marketplace links, old shares). */
const partnerPage = (p: PartnerInfo, onApex: boolean): Page =>
  onApex ? { host: APEX, path: `/p/${p.slug}`, partnerId: p.id } : { host: `${p.slug}.reserva.am`, path: '/', partnerId: p.id };

type BookingStep = 'branch' | 'service' | 'specialist' | 'datetime' | 'details' | 'confirm';

/** Seconds a visitor spends on each booking step before the next one. */
const STEP_SECONDS: Record<BookingStep, [number, number]> = {
  branch: [4, 15],
  service: [6, 40],
  specialist: [4, 25],
  datetime: [8, 60],
  details: [15, 90],
  confirm: [3, 20],
};
/** Chance an unconverted visitor moves on from each step. */
const STEP_CONTINUE: Record<BookingStep, number> = {
  branch: 0.9,
  service: 0.78,
  specialist: 0.8,
  datetime: 0.62,
  details: 0.7,
  confirm: 0.12,
};

const SERVICE_QUERIES = { hy: ['մանիկյուր', 'լազեր', 'մազեր', 'դեմք', 'հոնք'], ru: ['маникюр', 'лазер', 'стрижка', 'массаж', 'брови'] };
const MARKETPLACE_QUERIES = ['manicure', 'barber', 'laser', 'spa', 'nails arabkir', 'մանիկյուր', 'վարսավիր', 'маникюр', 'барбер', 'массаж'];
const MARKETPLACE_CATEGORIES = ['nails', 'hair', 'barber', 'spa', 'cosmetology', 'massage', 'lashes'];
const MARKETPLACE_AREAS = ['yerevan-kentron', 'yerevan-arabkir', 'yerevan-davtashen', 'yerevan-nor-nork', 'yerevan-shengavit', 'yerevan-ajapnyak'];

/** Contact buttons people use, by where they came from. */
const CONTACT_MIX = {
  social: [['whatsapp', 38], ['instagram', 24], ['call', 22], ['directions', 10], ['telegram', 3], ['facebook', 3]],
  search: [['call', 44], ['directions', 34], ['whatsapp', 14], ['website', 4], ['email', 2], ['instagram', 2]],
  other: [['call', 34], ['whatsapp', 30], ['directions', 22], ['instagram', 10], ['telegram', 2], ['facebook', 2]],
} as const;

// ══════════════════════════════════════════════════════════════
// Recording
// ══════════════════════════════════════════════════════════════

interface Gen {
  now: number;
  /** Ids come from their own stream, so they never shift any choice. */
  ids: Rng;
  sessions: Prisma.SiteSessionCreateManyInput[];
  events: Prisma.SiteEventCreateManyInput[];
  /** Visitors of the apex origin (marketplace, sign-up, /p/<slug>). */
  apexPool: Visitor[];
  parsedUa: Map<string, ParsedUserAgent>;
}

/** A uuid-shaped id with the demo prefix. */
function demoId(r: Rng): string {
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(r.next() * 16).toString(16)).join('');
  return `${DEMO_ANALYTICS_PREFIX}${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[r.int(0, 3)]}${hex(3)}-${hex(12)}`;
}

interface Draft {
  name: SiteEventName;
  props: Props;
  page: Page;
  at: number;
}

/** One session being written: events at offsets from its start, placed in time on commit. */
class Visit {
  private offset = 0;
  readonly drafts: Draft[] = [];

  constructor(
    readonly visitor: Visitor,
    readonly source: Source,
    readonly landing: Page,
    readonly internal = false,
  ) {}

  /** Record `name` `afterSec` seconds after the previous event. Props must pass the contract catalog. */
  emit(name: SiteEventName, props: Props, page: Page, afterSec = 0): this {
    this.offset += Math.round(afterSec * 1000);
    const parsed = EVENT_PROPS[name].safeParse(props);
    if (!parsed.success) throw new Error(`demo analytics: ${name} props break the catalog: ${JSON.stringify(props)}`);
    this.drafts.push({ name, props: parsed.data, page, at: this.offset });
    return this;
  }

  get duration(): number {
    return this.offset;
  }
}

/** Write a finished visit whose first event happened at `start`. Events after "now" never happened. */
function commit(g: Gen, v: Visit, start: number) {
  const drafts = v.drafts.filter((d) => start + d.at <= g.now);
  if (!drafts.length) return;

  const { source, visitor } = v;
  visitor.visits++;
  const channel = deriveChannel(source.utm?.source, source.referrer);
  if (channel !== source.channel) {
    throw new Error(`demo analytics: ${source.referrer || '(no referrer)'} reads as ${channel}, not ${source.channel}`);
  }
  let ua = g.parsedUa.get(visitor.device.ua);
  if (!ua) g.parsedUa.set(visitor.device.ua, (ua = parseUserAgent(visitor.device.ua)));

  const sessionId = demoId(g.ids);
  const utmQuery = source.utm
    ? `?utm_source=${source.utm.source}&utm_medium=${source.utm.medium}&utm_campaign=${source.utm.campaign}`
    : '';
  g.sessions.push({
    id: sessionId,
    visitorId: visitor.id,
    startedAt: new Date(start + drafts[0].at),
    lastSeenAt: new Date(start + drafts[drafts.length - 1].at),
    landingPath: `${v.landing.path}${utmQuery}`,
    landingHost: v.landing.host,
    referrer: source.referrer || null,
    referrerHost: referrerHostOf(source.referrer),
    channel,
    utmSource: source.utm?.source ?? null,
    utmMedium: source.utm?.medium ?? null,
    utmCampaign: source.utm?.campaign ?? null,
    deviceType: ua.deviceType,
    browser: ua.browser,
    os: ua.os,
    country: visitor.place.country,
    city: visitor.place.city,
    language: visitor.language,
    screenW: visitor.device.w,
    screenH: visitor.device.h,
    isBot: isBotUserAgent(visitor.device.ua),
    isInternal: v.internal,
  });
  for (const d of drafts) {
    const at = start + d.at;
    g.events.push({
      id: demoId(g.ids),
      sessionId,
      visitorId: visitor.id,
      name: d.name,
      partnerId: d.page.partnerId,
      path: d.page.path,
      host: d.page.host,
      props: d.props as Prisma.InputJsonValue,
      // The phone's clock runs a little ahead of the server receiving the batch.
      clientAt: new Date(at - 40 - Math.floor(g.ids.next() * 900)),
      createdAt: new Date(at),
    });
  }
}

const IN_APP_BROWSERS: readonly Device[] = [DEVICES.instagramIos, DEVICES.instagramAndroid, DEVICES.facebookIos];

/**
 * The visitor for a new session in `pool`: sometimes someone recent coming
 * back (same browser, device and language), otherwise a new one — speaking
 * `language` when the caller knows it (a booking records its locale).
 */
function visitorFor(
  g: Gen,
  r: Rng,
  pool: Visitor[],
  returning: number,
  language?: string,
): { visitor: Visitor; source: Source; isNew: boolean } {
  if (pool.length && r.chance(returning)) {
    const visitor = pool[pool.length - 1 - r.int(0, Math.min(RETURN_WINDOW, pool.length) - 1)];
    if (visitor.visits < MAX_VISITS_PER_VISITOR) return { visitor, source: comeBack(r, visitor), isNew: false };
  }
  const channel = r.weighted(CHANNEL_MIX);
  const drawn = r.weighted(LANGUAGES);
  const speaks = language ?? drawn;
  const visitor: Visitor = {
    id: demoId(g.ids),
    device: deviceFor(r, channel),
    language: speaks,
    place: r.weighted(PLACES[primaryLanguage(speaks)]),
    channel,
    visits: 0,
  };
  pool.push(visitor);
  return { visitor, source: sourceFor(r, channel), isNew: true };
}

/**
 * How a known visitor arrives again: an in-app browser can only be reopened
 * from inside its app; others sometimes type the address or use a bookmark.
 */
function comeBack(r: Rng, visitor: Visitor): Source {
  return sourceFor(r, IN_APP_BROWSERS.includes(visitor.device) || r.chance(0.75) ? visitor.channel : 'direct');
}

/** navigator.language for a booking's recorded UI locale. */
const BROWSER_LANGUAGE: Readonly<Record<string, string>> = { hy: 'hy-AM', ru: 'ru-RU', en: 'en-US' };

const secs = (r: Rng, [min, max]: [number, number]) => r.int(min, max);

// ══════════════════════════════════════════════════════════════
// Behaviour
// ══════════════════════════════════════════════════════════════

/** Looking around a salon's page: categories, the team, the gallery, branches, courses. */
function lookAround(v: Visit, r: Rng, p: PartnerInfo, page: Page, interest = 1) {
  const lang = primaryLanguage(v.visitor.language);
  if (p.categories.length > 1 && r.chance(0.3 * interest)) {
    for (let i = r.int(1, 2); i > 0; i--) v.emit('category_select', { cat: r.pick(p.categories) }, page, r.int(4, 30));
  }
  if (p.services.length && r.chance(0.05 * interest)) {
    const own = r.pick(p.services).name.split(/[\s—-]+/)[0].toLowerCase();
    const q = lang === 'en' || !r.chance(0.5) ? own : r.pick(SERVICE_QUERIES[lang]);
    if (q.length >= 2) v.emit('service_search', { q: q.slice(0, 60) }, page, r.int(5, 25));
  }
  if (p.specialists.length && r.chance(0.2 * interest)) v.emit('specialist_open', { sp: r.pick(p.specialists) }, page, r.int(5, 40));
  if (r.chance(0.16 * interest)) v.emit('gallery_open', { kind: r.weighted([['gallery', 6], ['works', 4]] as const) }, page, r.int(4, 30));
  if (p.locations.length > 1 && r.chance(0.12 * interest)) v.emit('branch_switch', { loc: r.pick(p.locations.slice(1)) }, page, r.int(3, 20));
  if (p.courses.length && r.chance(0.1 * interest)) {
    const course = r.pick(p.courses);
    v.emit('course_open', { course }, page, r.int(5, 40));
    if (r.chance(0.25)) v.emit('course_register_click', { course }, page, r.int(10, 60));
  }
  if (p.hasReviews && r.chance(0.08 * interest)) readReviews(v, r, p, page);
  // Opened the form and left without sending it.
  if (p.specialists.length && r.chance(0.015 * interest)) {
    const sp = r.pick(p.specialists);
    openReviewForm(v, r, p, page, sp);
    if (r.chance(0.25)) v.emit('review_error', { sp, code: 'no_stars' }, page, r.int(15, 90));
  }
}

/** Off to the reviews: the rating at the top of the page, or the Reviews tab. */
function readReviews(v: Visit, r: Rng, p: PartnerInfo, page: Page) {
  v.emit('reviews_open', { from: p.tabbed && r.chance(0.6) ? 'tab' : 'hero' }, page, r.int(5, 40));
}

/** "Write a review" for one specialist, from where the page keeps their reviews. */
function openReviewForm(v: Visit, r: Rng, p: PartnerInfo, page: Page, sp: string) {
  // A salon keeps reviews with each team member: their popup, or the tab's picker.
  if (!p.single && r.chance(p.tabbed ? 0.6 : 0.9)) v.emit('specialist_open', { sp }, page, r.int(4, 30));
  v.emit('review_form_open', { sp }, page, r.int(6, 50));
}

function contact(v: Visit, r: Rng, p: PartnerInfo, page: Page) {
  const channel = v.source.channel;
  const mix =
    channel === 'instagram' || channel === 'facebook' || channel === 'tiktok' || channel === 'telegram'
      ? CONTACT_MIX.social
      : channel === 'google' || channel === 'search'
        ? CONTACT_MIX.search
        : CONTACT_MIX.other;
  const ch = r.weighted(mix);
  // The sections the public site actually reports a contact tap from.
  const props: Props = { ch, from: r.weighted([['hero', 4], ['nav', 3], ['locations', 3], ['footer', 2]] as const) };
  if ((ch === 'call' || ch === 'directions') && p.locations.length) props.loc = r.pick(p.locations);
  v.emit('contact_click', props, page, r.int(5, 120));
}

/** Where a Book button was pressed, and what it pre-selected. */
function bookClick(r: Rng, p: PartnerInfo, booking?: BookingInfo) {
  // Only the Book buttons the public site has (team cards open the specialist
  // popup, which reports 'specialist'; there is no floating button).
  const from = r.weighted([
    ['hero', 30], ['services', 34], ['specialist', 16], ['nav', 10], ['locations', 6], ['footer', 4],
  ] as const);
  const pre: { svc?: string; sp?: string; loc?: string } = {};
  const sp = booking ? booking.specialistId : p.specialists.length ? r.pick(p.specialists) : null;
  if (from === 'services' && p.services.length) pre.svc = booking?.serviceId ?? r.pick(p.services).id;
  if (from === 'specialist' && sp) pre.sp = sp;
  if (from === 'locations' && p.locations.length) pre.loc = booking?.locationId ?? r.pick(p.locations);
  return { from, pre };
}

function stepsFor(p: PartnerInfo, pre: { svc?: string; sp?: string; loc?: string }, service?: ServiceInfo): BookingStep[] {
  const steps: BookingStep[] = [];
  if (p.locations.length > 1 && !pre.loc) steps.push('branch');
  if (!pre.svc) steps.push('service');
  if (!pre.sp && p.specialists.length && (service?.requiresSpecialist ?? true)) steps.push('specialist');
  steps.push('datetime', 'details', 'confirm');
  return steps;
}

/**
 * Walk the booking steps, each one arriving after the time spent on the one
 * before. Returns the step the visitor gave up on, or null when they made it
 * through `confirm`.
 */
function walkSteps(v: Visit, r: Rng, page: Page, steps: BookingStep[], goOn: (step: BookingStep) => boolean) {
  let previous: BookingStep | null = null;
  for (const step of steps) {
    v.emit('booking_step', { step }, page, previous ? secs(r, STEP_SECONDS[previous]) : 1);
    if (!goOn(step)) return step;
    previous = step;
  }
  return null;
}

/** Into the booking flow and out again without booking — most of them leave mid-way. */
function abandonBooking(v: Visit, r: Rng, p: PartnerInfo, page: Page) {
  const { from, pre } = bookClick(r, p);
  v.emit('book_click', { from, ...pre }, page, r.int(5, 90));
  if (!r.chance(0.93)) return;
  v.emit('booking_open', { from, ...pre }, page, 1);
  const stoppedAt = walkSteps(v, r, page, stepsFor(p, pre), (step) => r.chance(STEP_CONTINUE[step]));
  if (stoppedAt === null) {
    // Submitted, and it failed — someone else took the slot, or the network did.
    v.emit('booking_submit', { ...pre, any: r.chance(0.2) }, page, secs(r, STEP_SECONDS.confirm));
    v.emit('booking_error', { code: r.weighted([['slot_taken', 6], ['network', 2], ['validation', 2]] as const) }, page, 1);
    if (r.chance(0.5)) v.emit('booking_close', { step: 'confirm' }, page, r.int(5, 30));
    return;
  }
  if (r.chance(0.7)) v.emit('booking_close', { step: stoppedAt }, page, secs(r, STEP_SECONDS[stoppedAt]));
}

/** Browsing a salon's page without booking. */
function browsePartner(v: Visit, r: Rng, p: PartnerInfo, page: Page, interest = 1) {
  if (r.chance(0.18 * interest)) v.emit('page_view', { pt: 'partner' }, page, r.int(20, 240));
  lookAround(v, r, p, page, interest);
  const contactChance = p.bookingsEnabled ? 0.075 : 0.34;
  if (r.chance(contactChance)) contact(v, r, p, page);
  if (p.bookingsEnabled && r.chance(0.22 * interest)) abandonBooking(v, r, p, page);
}

/** The visit behind a real booking: look, click Book, every step, success — at the booking's own time. */
function bookingVisit(g: Gen, r: Rng, p: PartnerInfo, b: BookingInfo, windowStart: number) {
  const onApex = r.chance(0.25);
  // A newcomer browses in the language they then booked in.
  const found = visitorFor(g, r, onApex ? g.apexPool : p.pool, 0.32, BROWSER_LANGUAGE[b.locale ?? '']);
  const { visitor } = found;
  let { source } = found;
  const page = partnerPage(p, onApex);
  const bookedAt = b.createdAt.getTime();

  // Many bookers looked first: one to three earlier visits over the days
  // before, then came back to book — "Other visits by this person".
  if (found.isNew && r.chance(0.45)) {
    const earlier = [...new Set(Array.from({ length: r.int(1, 3) }, () => r.int(1, 10)))].sort((x, y) => y - x);
    for (const [i, daysBefore] of earlier.entries()) {
      const start = bookedAt - daysBefore * DAY + r.int(-3 * 60, 3 * 60) * MINUTE;
      if (start < windowStart) continue;
      const look = new Visit(visitor, i === 0 ? source : comeBack(r, visitor), page);
      look.emit('page_view', { pt: 'partner' }, page);
      lookAround(look, r, p, page, 1.3);
      if (r.chance(0.08)) contact(look, r, p, page);
      // Started booking, did not finish — and came back later to do it.
      if (r.chance(0.15)) abandonBooking(look, r, p, page);
      commit(g, look, start);
    }
    if (visitor.visits) source = comeBack(r, visitor);
  }

  const v = new Visit(visitor, source, page);
  v.emit('page_view', { pt: 'partner' }, page);
  // What they looked at leads to what they booked: its category, its specialist.
  const service = p.services.find((s) => s.id === b.serviceId);
  if (service?.category && p.categories.length > 1 && r.chance(0.55)) {
    v.emit('category_select', { cat: service.category }, page, r.int(4, 30));
  }
  if (b.specialistId && r.chance(0.35)) v.emit('specialist_open', { sp: b.specialistId }, page, r.int(5, 40));
  lookAround(v, r, p, page, 0.4);

  const { from, pre } = bookClick(r, p, b);
  v.emit('book_click', { from, ...pre }, page, r.int(5, 60));
  v.emit('booking_open', { from, ...pre }, page, 1);
  walkSteps(v, r, page, stepsFor(p, pre, service), () => true);
  const target = { svc: b.serviceId, loc: b.locationId, ...(b.specialistId ? { sp: b.specialistId } : {}) };
  v.emit('booking_submit', { ...target, any: !pre.sp && r.chance(0.15) }, page, secs(r, STEP_SECONDS.confirm));
  v.emit('booking_success', target, page, 1);
  // The booking row is written while the success screen is on its way.
  commit(g, v, bookedAt + 600 - v.duration);
}

/** The visit behind a real review: mostly a client who has been before, ending at the review's createdAt. */
function reviewVisit(g: Gen, r: Rng, p: PartnerInfo, review: ReviewInfo) {
  const onApex = r.chance(0.15);
  const { visitor, source } = visitorFor(g, r, onApex ? g.apexPool : p.pool, 0.6);
  const page = partnerPage(p, onApex);
  const v = new Visit(visitor, source, page);
  v.emit('page_view', { pt: 'partner' }, page);
  if (p.hasReviews && r.chance(0.45)) readReviews(v, r, p, page);
  openReviewForm(v, r, p, page, review.specialistId);
  // Pressed Send before choosing the stars.
  if (r.chance(0.12)) v.emit('review_error', { sp: review.specialistId, code: 'no_stars' }, page, r.int(20, 80));
  v.emit('review_success', { sp: review.specialistId, stars: review.rating }, page, r.int(25, 140));
  commit(g, v, review.createdAt.getTime() + 400 - v.duration);
}

/** A browsing (not booking) visit to a salon's page, starting at `start`. */
function partnerVisit(g: Gen, r: Rng, p: PartnerInfo, start: number) {
  const onApex = r.chance(0.2);
  const { visitor, source } = visitorFor(g, r, onApex ? g.apexPool : p.pool, 0.22);
  const page = partnerPage(p, onApex);
  const v = new Visit(visitor, source, page);
  v.emit('page_view', { pt: 'partner' }, page);
  // A third land and leave without doing anything — the console's "bounced".
  if (!r.chance(0.33)) browsePartner(v, r, p, page);
  commit(g, v, start);
}

/** The marketplace: home or /salons, filters, a salon card, often on into that salon's page. */
function marketplaceVisit(g: Gen, r: Rng, listed: readonly (readonly [PartnerInfo, number])[], start: number) {
  const { visitor, source } = visitorFor(g, r, g.apexPool, 0.25);
  const landing = r.weighted([
    [apexPage('/'), 45],
    [apexPage('/salons'), 40],
    [apexPage(`/salons/c/${r.pick(['nails', 'hair', 'barber', 'spa'])}`), 15],
  ] as const);
  const v = new Visit(visitor, source, landing);

  if (landing.path === '/') {
    v.emit('page_view', { pt: 'home' }, landing);
    const next = r.next();
    if (next < 0.07) {
      const signup = apexPage('/signup');
      v.emit('page_view', { pt: 'signup' }, signup, r.int(8, 60));
      signupAttempt(v, r, signup);
      return commit(g, v, start);
    }
    if (next > 0.45) return commit(g, v, start);
    v.emit('page_view', { pt: 'marketplace' }, apexPage('/salons'), r.int(5, 45));
  } else {
    v.emit('page_view', { pt: 'marketplace' }, landing);
  }

  const salons = apexPage('/salons');
  if (r.chance(0.25)) {
    const filter: Props = {};
    if (r.chance(0.7)) filter.cat = r.pick(MARKETPLACE_CATEGORIES);
    if (!filter.cat || r.chance(0.4)) filter.area = r.pick(MARKETPLACE_AREAS);
    v.emit('salons_filter', filter, salons, r.int(4, 30));
  }
  if (r.chance(0.15)) v.emit('salons_search', { q: r.pick(MARKETPLACE_QUERIES) }, salons, r.int(4, 30));
  if (listed.length && r.chance(0.52)) {
    const p = r.weighted(listed);
    v.emit('salon_click', { slug: p.slug, pos: Math.min(1000, listed.findIndex(([x]) => x === p) + r.int(0, 2)) }, salons, r.int(5, 60));
    if (r.chance(0.65)) {
      const page = partnerPage(p, true);
      v.emit('page_view', { pt: 'partner' }, page, 2);
      browsePartner(v, r, p, page, 0.8);
    }
  }
  commit(g, v, start);
}

const SIGNUP_ERRORS: readonly (readonly [Props, number])[] = [
  [{ field: 'slug', code: 'taken' }, 4],
  [{ field: 'email', code: 'taken' }, 3],
  [{ field: 'phone', code: 'invalid' }, 2],
  [{ code: 'network' }, 1],
];

/** Filling the sign-up form. Without `success` the visitor never gets through. */
function signupAttempt(v: Visit, r: Rng, page: Page, success = false) {
  if (!success && !r.chance(0.34)) return;
  v.emit('signup_start', {}, page, r.int(5, 40));
  const steps = ['business', 'owner', 'account'];
  for (const [i, step] of steps.entries()) {
    v.emit('signup_step', { step }, page, r.int(15, 70));
    if (!success && i < steps.length - 1 && !r.chance(0.68)) return;
  }
  if (success) {
    if (r.chance(0.3)) {
      v.emit('signup_submit', {}, page, r.int(10, 40));
      v.emit('signup_error', { ...r.weighted(SIGNUP_ERRORS) }, page, 1);
    }
    v.emit('signup_submit', {}, page, r.int(10, 40));
    v.emit('signup_success', {}, page, 1);
    return;
  }
  if (!r.chance(0.3)) return;
  v.emit('signup_submit', {}, page, r.int(10, 40));
  v.emit('signup_error', { ...r.weighted(SIGNUP_ERRORS) }, page, 1);
}

function signupVisit(g: Gen, r: Rng, start: number) {
  const { visitor, source } = visitorFor(g, r, g.apexPool, 0.15);
  const page = apexPage('/signup');
  const v = new Visit(visitor, source, page);
  v.emit('page_view', { pt: 'signup' }, page);
  signupAttempt(v, r, page);
  commit(g, v, start);
}

/** The sign-up behind a real pending registration, ending at its createdAt. */
function registrationVisit(g: Gen, r: Rng, createdAt: Date) {
  const { visitor, source } = visitorFor(g, r, g.apexPool, 0.3);
  const page = apexPage('/signup');
  const v = new Visit(visitor, source, page);
  v.emit('page_view', { pt: 'signup' }, page);
  signupAttempt(v, r, page, true);
  commit(g, v, createdAt.getTime() + 500 - v.duration);
}

/** Staff opening their own page (often trying the booking flow): what includeInternal reveals. */
function staffVisit(g: Gen, r: Rng, staff: readonly Visitor[], partners: readonly PartnerInfo[], start: number) {
  const visitor = r.pick(staff);
  const p = r.weighted(partners.map((x) => [x, x.slug === 'ohanyan-test' || x.slug === 'antheris' ? 3 : 1] as const));
  const page = partnerPage(p, false);
  const v = new Visit(visitor, sourceFor(r, 'direct'), page, true);
  v.emit('page_view', { pt: 'partner' }, page);
  for (let i = r.int(0, 3); i > 0; i--) v.emit('page_view', { pt: 'partner' }, page, r.int(10, 120));
  if (p.bookingsEnabled && r.chance(0.45)) abandonBooking(v, r, p, page);
  commit(g, v, start);
}

/** Crawlers and previews that run the page's JavaScript. Stored, flagged, never counted. */
function botVisit(g: Gen, r: Rng, partners: readonly PartnerInfo[], start: number) {
  const device = r.pick(BOT_DEVICES);
  const visitor: Visitor = {
    id: demoId(g.ids),
    device,
    language: 'en-US',
    place: r.weighted([[place('US', 'Mountain View'), 4], [place('US'), 2], [place('IE', 'Dublin'), 1], [place('DE'), 1], [place(null), 2]] as const),
    channel: 'direct',
    visits: 0,
  };
  const p = r.pick(partners);
  const page = r.weighted([
    [partnerPage(p, r.chance(0.5)), 6],
    [apexPage('/'), 2],
    [apexPage('/salons'), 2],
    [apexPage('/signup'), 1],
  ] as const);
  const pt = page.partnerId ? 'partner' : page.path === '/' ? 'home' : page.path === '/signup' ? 'signup' : 'marketplace';
  commit(g, new Visit(visitor, sourceFor(r, 'direct'), page).emit('page_view', { pt }, page), start);
}

// ══════════════════════════════════════════════════════════════
// Time
// ══════════════════════════════════════════════════════════════

/** Yerevan hour-of-day weights: quiet nights, a lunch peak, a bigger evening one on the phone. */
const HOUR_WEIGHTS = [1.2, 0.7, 0.4, 0.25, 0.2, 0.2, 0.35, 0.7, 1.2, 2, 2.8, 3.3, 3.6, 3.5, 3.2, 3.1, 3.2, 3.4, 3.8, 4.3, 4.6, 4.4, 3.4, 2.2];
const HOURS = HOUR_WEIGHTS.map((w, h) => [h, w] as const);
/** Sunday … Saturday. Beauty traffic climbs towards the weekend and dips on Sunday. */
const WEEKDAY_FACTOR = [0.82, 0.96, 0.97, 1, 1.06, 1.14, 1.18];

/** Session starts for one stream: `perDay` on an average day, shaped by weekday, a gentle growth trend and noise. */
function startsPerDay(r: Rng, now: number, perDay: number): number[] {
  const starts: number[] = [];
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const day = dayStart(i - (WINDOW_DAYS - 1));
    const trend = 0.85 + (0.25 * i) / (WINDOW_DAYS - 1);
    const expected = perDay * WEEKDAY_FACTOR[day.getDay()] * trend * (0.85 + r.next() * 0.3);
    const n = Math.floor(expected) + (r.chance(expected % 1) ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const at = day.getTime() + r.weighted(HOURS) * HOUR + r.int(0, 59) * MINUTE + r.int(0, 59) * 1000;
      if (at <= now) starts.push(at);
    }
  }
  return starts;
}

// ══════════════════════════════════════════════════════════════
// Seeding
// ══════════════════════════════════════════════════════════════

async function loadPartners(prisma: PrismaClient, from: Date, now: Date): Promise<PartnerInfo[]> {
  const slugs = PARTNERS.filter((p) => p.slug && p.active !== false).map((p) => p.slug!);
  const rows = await prisma.partner.findMany({
    where: { slug: { in: slugs }, active: true, deletedAt: null },
    orderBy: { slug: 'asc' },
    select: {
      id: true,
      slug: true,
      bookingsEnabled: true,
      kind: true,
      template: true,
      presentation: { select: { reviews: true } },
      marketplaceListed: true,
      coursesEnabled: true,
      locations: { where: { deletedAt: null }, select: { id: true }, orderBy: { id: 'asc' } },
      services: {
        where: { deletedAt: null, active: true },
        select: { id: true, name: true, category: true, requiresSpecialist: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      },
      specialists: { where: { deletedAt: null, active: true }, select: { id: true }, orderBy: { id: 'asc' } },
      courses: { where: { deletedAt: null, active: true }, select: { id: true }, orderBy: { id: 'asc' } },
      bookings: {
        where: { source: 'public', createdAt: { gte: from, lte: now } },
        select: { createdAt: true, serviceId: true, specialistId: true, locationId: true, locale: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  });
  const reviews = await prisma.specialistReview.findMany({
    where: { partnerId: { in: rows.map((p) => p.id) }, createdAt: { gte: from, lte: now } },
    select: { partnerId: true, specialistId: true, rating: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map((p) => ({
    id: p.id,
    slug: p.slug!,
    bookingsEnabled: p.bookingsEnabled,
    single: p.kind === 'single',
    tabbed: p.template === 'tabbed',
    hasReviews: (p.presentation?.reviews ?? 0) > 0,
    listed: p.marketplaceListed,
    locations: p.locations.map((l) => l.id),
    services: p.services,
    categories: [...new Set(p.services.map((s) => s.category).filter(Boolean))],
    specialists: p.specialists.map((s) => s.id),
    courses: p.coursesEnabled ? p.courses.map((c) => c.id) : [],
    bookings: p.bookingsEnabled ? p.bookings : [],
    // Only the active team can be reviewed on the page.
    reviews: reviews.filter((v) => v.partnerId === p.id && p.specialists.some((s) => s.id === v.specialistId)),
    pool: [],
  }));
}

export interface DemoAnalyticsSummary {
  sessions: number;
  events: number;
  visitors: number;
  partners: { slug: string; sessions: number; bookingsTracked: number; bookings: number }[];
  bots: number;
  internal: number;
}

/** Remove every demo analytics row (sessions cascade to their events). */
export async function cleanDemoAnalytics(prisma: PrismaClient): Promise<number> {
  await prisma.siteEvent.deleteMany({ where: { id: { startsWith: DEMO_ANALYTICS_PREFIX } } });
  const { count } = await prisma.siteSession.deleteMany({ where: { id: { startsWith: DEMO_ANALYTICS_PREFIX } } });
  return count;
}

/**
 * Generate ~45 days of demo traffic for the demo partners that exist right
 * now, from their current catalog and public bookings. Call cleanDemoAnalytics
 * first; this only inserts.
 */
export async function seedDemoAnalytics(prisma: PrismaClient): Promise<DemoAnalyticsSummary> {
  const now = Date.now();
  const from = dayStart(-(WINDOW_DAYS - 1));
  const partners = await loadPartners(prisma, from, new Date(now));
  const registrations = await prisma.pendingRegistration.findMany({
    // Vacancy sign-ups happen on the vacancies board, which this tracker does not cover.
    where: { product: 'bookings', createdAt: { gte: from, lte: new Date(now) } },
    select: { createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const g: Gen = { now, ids: rng('site-analytics:ids'), sessions: [], events: [], apexPool: [], parsedUa: new Map() };

  // Every visit is planned first, then played out in time order, so a
  // "returning visitor" has always visited before.
  const plans: { at: number; run: () => void }[] = [];
  const plan = (at: number, run: () => void) => plans.push({ at, run });

  for (const p of partners) {
    const r = rng(`site-analytics:${p.slug}`);
    const perDay = Math.max(
      MIN_SESSIONS_PER_DAY[p.slug] ?? DEFAULT_MIN_SESSIONS_PER_DAY,
      (SESSIONS_PER_BOOKING * p.bookings.length) / WINDOW_DAYS,
    );
    for (const at of startsPerDay(r, now, perDay)) plan(at, () => partnerVisit(g, r, p, at));

    const rb = rng(`site-analytics:${p.slug}:bookings`);
    for (const b of p.bookings) {
      if (rb.chance(TRACKED_SHARE)) {
        plan(b.createdAt.getTime() - 8 * MINUTE, () => bookingVisit(g, rb, p, b, from.getTime()));
      }
    }

    const rr = rng(`site-analytics:${p.slug}:reviews`);
    for (const review of p.reviews) {
      if (rr.chance(TRACKED_SHARE)) plan(review.createdAt.getTime() - 4 * MINUTE, () => reviewVisit(g, rr, p, review));
    }
  }

  // Marketplace cards are clicked roughly in proportion to how busy a salon is.
  const listed = partners.filter((p) => p.listed).map((p) => [p, 4 + p.bookings.length / 20] as const);
  const rm = rng('site-analytics:marketplace');
  for (const at of startsPerDay(rm, now, MARKETPLACE_SESSIONS_PER_DAY)) plan(at, () => marketplaceVisit(g, rm, listed, at));

  const rs = rng('site-analytics:signup');
  for (const at of startsPerDay(rs, now, SIGNUP_SESSIONS_PER_DAY)) plan(at, () => signupVisit(g, rs, at));
  for (const reg of registrations) plan(reg.createdAt.getTime() - 6 * MINUTE, () => registrationVisit(g, rs, reg.createdAt));

  const rt = rng('site-analytics:staff');
  const staff: Visitor[] = [DEVICES.winChrome, DEVICES.macChrome, DEVICES.iosSafari, DEVICES.androidChrome].map((device, i) => ({
    id: demoId(g.ids),
    device,
    language: i === 3 ? 'ru-RU' : 'hy-AM',
    place: place('AM', 'Yerevan'),
    channel: 'direct',
    visits: 0,
  }));
  for (const at of startsPerDay(rt, now, STAFF_SESSIONS_PER_DAY)) plan(at, () => staffVisit(g, rt, staff, partners, at));

  const rbot = rng('site-analytics:bots');
  for (const at of startsPerDay(rbot, now, BOT_SESSIONS_PER_DAY)) plan(at, () => botVisit(g, rbot, partners, at));

  plans.sort((a, b) => a.at - b.at);
  for (const p of plans) p.run();

  for (let i = 0; i < g.sessions.length; i += 1000) {
    await prisma.siteSession.createMany({ data: g.sessions.slice(i, i + 1000) });
  }
  for (let i = 0; i < g.events.length; i += 2000) {
    await prisma.siteEvent.createMany({ data: g.events.slice(i, i + 2000) });
  }

  const sessionsByPartner = new Map<string, Set<string>>();
  const successes = new Map<string, number>();
  for (const e of g.events) {
    if (!e.partnerId) continue;
    let set = sessionsByPartner.get(e.partnerId);
    if (!set) sessionsByPartner.set(e.partnerId, (set = new Set()));
    set.add(e.sessionId);
    if (e.name === 'booking_success') successes.set(e.partnerId, (successes.get(e.partnerId) ?? 0) + 1);
  }
  return {
    sessions: g.sessions.length,
    events: g.events.length,
    visitors: new Set(g.sessions.map((s) => s.visitorId)).size,
    partners: partners.map((p) => ({
      slug: p.slug,
      sessions: sessionsByPartner.get(p.id)?.size ?? 0,
      bookingsTracked: successes.get(p.id) ?? 0,
      bookings: p.bookings.length,
    })),
    bots: g.sessions.filter((s) => s.isBot).length,
    internal: g.sessions.filter((s) => s.isInternal).length,
  };
}

/** Days of demo history (for the seed report). */
export const DEMO_ANALYTICS_DAYS = WINDOW_DAYS;
