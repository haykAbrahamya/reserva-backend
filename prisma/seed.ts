/**
 * Demo data for local development: every partner type, product and state.
 *
 *   pnpm db:seed          # demo professionals + everything below (idempotent)
 *   pnpm db:seed:clean    # remove the demo tenants again
 *
 * What it builds (see prisma/demo/partners.ts for the tenants themselves):
 *   · 10 partners — salons and solo pros, both page templates, contact-only
 *     mode, a deactivated tenant, vacancies-only tenants, trial and suspended
 *     product grants, partners with and without a slug
 *   · branches with areas, hours (one closing at 02:30), translated catalogs
 *     with fixed / range / hidden prices and capacity-based facility services
 *   · specialists with schedules, time off, generated portraits and reviews
 *   · ~6 weeks of bookings in every status and from both sources, placed inside
 *     real working hours so the calendar looks like a calendar
 *   · courses with current + archived runs and members, vacancies in every
 *     lifecycle state with applicants (some linked to demo professionals),
 *     bell notifications, support threads
 *   · platform staff, pending signups, demo requests and visitor analytics for
 *     the internal console
 *
 * Every demo login uses the password in DEMO_PASSWORD; the full list is printed
 * at the end of a run.
 *
 * SAFETY. Re-running rebuilds ONLY what this script owns: partners carrying a
 * demo slug or demo staff email, its pending signups, demo requests, and visits
 * from RFC 5737 documentation IPs. Against a database that is not on localhost
 * it refuses to run without --yes.
 */
// Pin the clock BEFORE any Date is built — the same rule as src/main.ts, so
// "11:00" in the fixtures is 11:00 in the salon's own time zone.
process.env.TZ = process.env.TZ || 'Asia/Yerevan';

import { existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import type { BookingSource, BookingStatus, NotificationType, VacancyApplicationStatus } from '@prisma/client';

import { PasswordService } from '../src/auth/password.service';
import { newId } from '../src/common/ids';
import { avatarSvg, coverSvg, interiorSvg, logoSvg, removeUploads, storeSvg, workSvg } from './demo/images';
import {
  PARTNERS,
  PENDING_SIGNUPS,
  PLATFORM_STAFF,
  type DemoPartner,
  type DemoRun,
  type DemoService,
  type Week,
} from './demo/partners';
import {
  APPLICANTS,
  BOOKING_NOTES,
  CLIENTS,
  DEMO_REQUESTS,
  MEMBERS,
  REVIEW_AUTHORS,
  REVIEW_TEXT,
  WALK_INS,
  type Person,
} from './demo/people';
import { DAY, HOUR, MINUTE, at, dayStart, daysFromNow, minutesAgo, rng, toMinutes, weekdayKey, type Rng } from './demo/random';

// The CLI scripts run outside Nest, so load .env the way ConfigModule would.
const ENV_FILE = resolve(process.cwd(), '.env');
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const prisma = new PrismaClient();
const argv = process.argv.slice(2);
const CLEAN_ONLY = argv.includes('--clean');
const CONFIRMED = argv.includes('--yes');

/** Shared password for every demo staff, platform and pending-signup account. */
export const DEMO_PASSWORD = 'demo1234';
/** Owned by prisma/seed-professionals.ts — only ever read here, never written. */
const PRO_PHONE_PREFIX = '+37455';
/** RFC 5737 documentation ranges: no real visitor can ever have these. */
const VISIT_IP_PREFIXES = ['203.0.113.', '198.51.100.', '192.0.2.'];
/** Mirrors LISTING_TTL_DAYS in VacanciesService. */
const LISTING_TTL_DAYS = 30;

const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR);
const json = (v: unknown): Prisma.InputJsonValue | undefined =>
  v == null ? undefined : (v as Prisma.InputJsonValue);
const later = (a: Date, b: Date) => (a > b ? a : b);
/** A demo price's type: as declared, else a ceiling makes it a range (no ceiling + 'range' = "from X"). */
const unitType = (p: { priceType?: 'fixed' | 'range'; priceMax?: number }): 'fixed' | 'range' =>
  p.priceType ?? (p.priceMax ? 'range' : 'fixed');
const earlier = (a: Date, b: Date) => (a < b ? a : b);

interface Pro {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  locale: string;
}

interface Ctx {
  hash: string;
  owner: { id: string; name: string };
  pros: Pro[];
  proCursor: number;
  roleNames: Map<string, string>;
}

interface Summary {
  spec: DemoPartner;
  counts: Record<string, number>;
}

// ══════════════════════════════════════════════════════════════
// Safety
// ══════════════════════════════════════════════════════════════

function refuse(message: string): never {
  console.error(`\nRefusing to seed:\n  ${message}\n`);
  process.exit(1);
}

async function preflight(): Promise<Map<string, string>> {
  const url = process.env.DATABASE_URL ?? '';
  const host = url.replace(/^.*@/, '').replace(/\?.*$/, '') || '(DATABASE_URL is not set)';
  if (!/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url) && !CONFIRMED) {
    refuse(
      `DATABASE_URL does not point at localhost (${host}).` +
        `\n  This seed deletes and rebuilds demo tenants — re-run with --yes if you really mean it.`,
    );
  }

  // The fixtures reference catalog rows created by migrations; without them
  // inserts would fail on a foreign key halfway through.
  const products = await prisma.product.findMany({ select: { key: true } });
  const missingProducts = ['bookings', 'courses', 'vacancies'].filter((k) => !products.some((p) => p.key === k));
  if (missingProducts.length) {
    refuse(`The product catalog is missing ${missingProducts.join(', ')}. Run: pnpm prisma:deploy`);
  }

  const areaKeys = [...new Set(PARTNERS.flatMap((p) => p.locations.map((l) => l.areaKey)).filter((k): k is string => !!k))];
  const areas = await prisma.area.findMany({ where: { key: { in: areaKeys } }, select: { key: true } });
  const missingAreas = areaKeys.filter((k) => !areas.some((a) => a.key === k));
  if (missingAreas.length) refuse(`The area catalog is missing ${missingAreas.join(', ')}. Run: pnpm prisma:deploy`);

  const specialtyKeys = [...new Set(PARTNERS.flatMap((p) => (p.vacancies ?? []).map((v) => v.specialtyKey)))];
  const specialties = await prisma.specialty.findMany({
    where: { key: { in: specialtyKeys } },
    select: { key: true, roleName: true },
  });
  const missingSpecialties = specialtyKeys.filter((k) => !specialties.some((s) => s.key === k));
  if (missingSpecialties.length) {
    refuse(`The specialty catalog is missing ${missingSpecialties.join(', ')}. Run: pnpm prisma:deploy`);
  }

  console.log(`database : ${host}`);
  return new Map(specialties.map((s) => [s.key, s.roleName]));
}

// ══════════════════════════════════════════════════════════════
// Clean
// ══════════════════════════════════════════════════════════════

async function clean(): Promise<number> {
  const slugs = [
    ...PARTNERS.map((p) => p.slug),
    ...PENDING_SIGNUPS.map((p) => p.slug), // in case a pending signup was activated from the console
  ].filter((s): s is string => !!s);
  const emails = [
    ...PARTNERS.flatMap((p) => p.users.map((u) => u.email.toLowerCase())),
    ...PENDING_SIGNUPS.map((p) => p.adminEmail),
  ];

  const victims = await prisma.partner.findMany({
    where: { OR: [{ slug: { in: slugs } }, { users: { some: { email: { in: emails } } } }] },
    select: { id: true },
  });
  const ids = victims.map((v) => v.id);

  if (ids.length) {
    // Children that RESTRICT a partner cascade go first — the same order as
    // PlatformPartnersService.hardDelete; the partner delete cascades the rest.
    await prisma.$transaction([
      prisma.booking.deleteMany({ where: { partnerId: { in: ids } } }),
      prisma.vacancy.deleteMany({ where: { partnerId: { in: ids } } }),
      prisma.course.deleteMany({ where: { partnerId: { in: ids } } }),
      prisma.specialist.deleteMany({ where: { partnerId: { in: ids } } }),
      prisma.notification.deleteMany({ where: { partnerId: { in: ids } } }),
      prisma.partner.deleteMany({ where: { id: { in: ids } } }),
    ]);
    for (const id of ids) await removeUploads(id);
  }

  await prisma.pendingRegistration.deleteMany({ where: { adminEmail: { in: PENDING_SIGNUPS.map((p) => p.adminEmail) } } });
  await prisma.demoRequest.deleteMany({ where: { name: { in: DEMO_REQUESTS.map((d) => d.name) } } });
  await prisma.visitorEvent.deleteMany({ where: { OR: VISIT_IP_PREFIXES.map((p) => ({ ip: { startsWith: p } })) } });
  if (CLEAN_ONLY) {
    await prisma.platformUser.deleteMany({ where: { email: { in: PLATFORM_STAFF.map((s) => s.email) } } });
  }
  return ids.length;
}

// ══════════════════════════════════════════════════════════════
// Platform side
// ══════════════════════════════════════════════════════════════

async function seedPlatformStaff(hash: string) {
  const rows: { id: string; name: string; role: string }[] = [];
  for (const s of PLATFORM_STAFF) {
    // Upsert, so the ids — referenced by audit fields — stay stable across runs.
    const row = await prisma.platformUser.upsert({
      where: { email: s.email },
      create: {
        id: newId(),
        name: s.name,
        email: s.email,
        role: s.role,
        passwordHash: hash,
        lastLogin: hoursAgo(s.lastLoginHoursAgo),
        createdAt: daysFromNow(-200),
      },
      update: {
        name: s.name,
        role: s.role,
        passwordHash: hash,
        active: true,
        deletedAt: null,
        mustChangePassword: false,
        lastLogin: hoursAgo(s.lastLoginHoursAgo),
      },
    });
    rows.push(row);
  }
  const owner = rows.find((r) => r.role === 'owner')!;
  return { owner: { id: owner.id, name: owner.name } };
}

async function seedDemoRequests(ownerId: string) {
  await prisma.demoRequest.createMany({
    data: DEMO_REQUESTS.map((d) => {
      const createdAt = hoursAgo(d.hoursAgo);
      return {
        id: newId(),
        name: d.name,
        company: d.company || null,
        phone: d.phone || null,
        email: d.email || null,
        notes: d.notes || null,
        status: d.status,
        handledBy: d.status === 'done' ? ownerId : null,
        handledAt: d.status === 'done' ? new Date(createdAt.getTime() + 2 * DAY) : null,
        createdAt,
      };
    }),
  });
}

async function seedPendingSignups(hash: string) {
  await prisma.pendingRegistration.createMany({
    data: PENDING_SIGNUPS.map((p) => ({
      id: newId(),
      // Random: nobody can activate these by link — staff activate them from
      // the console (activateById), which is the flow they exist to show.
      tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
      companyName: p.companyName,
      companyType: p.companyType,
      slug: p.slug,
      accent: p.accent,
      kind: p.kind,
      product: p.product,
      adminName: p.adminName,
      adminEmail: p.adminEmail,
      adminPhone: p.adminPhone,
      passwordHash: hash,
      expiresAt: new Date(Date.now() + p.expiresInHours * HOUR),
      createdAt: hoursAgo(p.createdHoursAgo),
    })),
  });
}

interface VisitDevice {
  deviceType: string;
  browser: string;
  browserVer: string;
  os: string;
  osVer: string;
  w: number;
  h: number;
  ua: string;
}

interface VisitPlace {
  country: string;
  city: string | null;
  ip: string;
  langs: string[];
}

/** A month of public-site page views for the console's Visits page. */
async function seedVisits(): Promise<number> {
  const r = rng('visits');
  const tenantSlugs = PARTNERS.filter((p) => p.slug && p.active !== false).map((p) => p.slug!);
  const pages: (readonly [{ path: string; host: string; slug: string | null }, number])[] = [
    [{ path: '/', host: 'reserva.am', slug: null }, 20],
    [{ path: '/salons', host: 'reserva.am', slug: null }, 14],
    [{ path: '/salons/c/nails', host: 'reserva.am', slug: null }, 3],
    [{ path: '/salons/c/hair', host: 'reserva.am', slug: null }, 3],
    [{ path: '/signup', host: 'reserva.am', slug: null }, 4],
    ...tenantSlugs.map((s, i) => [{ path: `/p/${s}`, host: 'reserva.am', slug: s }, Math.max(2, 12 - i * 2)] as const),
    [{ path: '/', host: 'antheris.reserva.am', slug: 'antheris' }, 4],
    [{ path: '/', host: 'gohar.reserva.am', slug: 'gohar' }, 3],
  ];
  const devices: [VisitDevice, number][] = [
    [{ deviceType: 'mobile', browser: 'Mobile Safari', browserVer: '18.6', os: 'iOS', osVer: '18.6', w: 390, h: 844,
       ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1' }, 34],
    [{ deviceType: 'mobile', browser: 'Mobile Chrome', browserVer: '140.0.7339.207', os: 'Android', osVer: '15', w: 412, h: 915,
       ua: 'Mozilla/5.0 (Linux; Android 15; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.207 Mobile Safari/537.36' }, 24],
    [{ deviceType: 'mobile', browser: 'Samsung Internet', browserVer: '28.0', os: 'Android', osVer: '14', w: 384, h: 854,
       ua: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36' }, 6],
    [{ deviceType: 'desktop', browser: 'Chrome', browserVer: '140.0.0.0', os: 'Windows', osVer: '10', w: 1920, h: 1080,
       ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' }, 15],
    [{ deviceType: 'desktop', browser: 'Safari', browserVer: '18.6', os: 'macOS', osVer: '10.15.7', w: 1440, h: 900,
       ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15' }, 8],
    [{ deviceType: 'desktop', browser: 'Edge', browserVer: '140.0.0.0', os: 'Windows', osVer: '10', w: 1536, h: 864,
       ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0' }, 4],
    [{ deviceType: 'desktop', browser: 'Firefox', browserVer: '143.0', os: 'Windows', osVer: '10', w: 2560, h: 1440,
       ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0' }, 4],
    [{ deviceType: 'tablet', browser: 'Mobile Safari', browserVer: '18.6', os: 'iOS', osVer: '18.6', w: 820, h: 1180,
       ua: 'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1' }, 5],
  ];
  const places: [VisitPlace, number][] = [
    [{ country: 'AM', city: 'Yerevan', ip: '203.0.113.', langs: ['hy-AM', 'hy-AM', 'ru-RU', 'en-US'] }, 62],
    [{ country: 'AM', city: 'Gyumri', ip: '203.0.113.', langs: ['hy-AM', 'ru-RU'] }, 8],
    [{ country: 'AM', city: 'Vanadzor', ip: '203.0.113.', langs: ['hy-AM'] }, 4],
    [{ country: 'AM', city: null, ip: '192.0.2.', langs: ['hy-AM'] }, 4],
    [{ country: 'RU', city: 'Moscow', ip: '198.51.100.', langs: ['ru-RU'] }, 10],
    [{ country: 'US', city: 'Glendale', ip: '198.51.100.', langs: ['en-US', 'hy-AM'] }, 5],
    [{ country: 'GE', city: 'Tbilisi', ip: '198.51.100.', langs: ['ru-RU', 'ka-GE'] }, 4],
    [{ country: 'FR', city: 'Paris', ip: '198.51.100.', langs: ['fr-FR', 'hy-AM'] }, 3],
  ];
  const referrers: [string | null, number][] = [
    [null, 35], ['https://www.instagram.com/', 25], ['https://www.google.com/', 20], ['https://www.facebook.com/', 8],
    ['https://t.me/', 6], ['https://yandex.ru/', 3], ['https://www.tiktok.com/', 3],
  ];

  const rows: Prisma.VisitorEventCreateManyInput[] = [];
  const now = Date.now();
  for (let d = 29; d >= 0; d--) {
    const weekend = [0, 6].includes(dayStart(-d).getDay());
    const n = r.int(6, 16) + (weekend ? 5 : 0);
    for (let i = 0; i < n; i++) {
      const createdAt = new Date(dayStart(-d).getTime() + r.int(8 * 60, 23 * 60 + 59) * MINUTE);
      if (createdAt.getTime() > now) continue;
      const page = r.weighted(pages);
      const dev = r.weighted(devices);
      const place = r.weighted(places);
      rows.push({
        id: newId(),
        ip: `${place.ip}${r.int(1, 254)}`,
        userAgent: dev.ua,
        deviceType: dev.deviceType,
        browser: dev.browser,
        browserVer: dev.browserVer,
        os: dev.os,
        osVer: dev.osVer,
        path: page.path,
        host: page.host,
        partnerSlug: page.slug,
        referrer: r.weighted(referrers),
        language: r.pick(place.langs),
        screenW: dev.w,
        screenH: dev.h,
        country: place.country,
        city: place.city,
        createdAt,
      });
    }
  }
  await prisma.visitorEvent.createMany({ data: rows });
  return rows.length;
}

// ══════════════════════════════════════════════════════════════
// Partners
// ══════════════════════════════════════════════════════════════

type Window = [number, number] | 'closed' | 'any';

/** A day's open window in minutes from local midnight; an end ≤ start runs past midnight. */
function dayWindow(schedule: Week | null | undefined, date: Date): Window {
  if (!schedule || Object.keys(schedule).length === 0) return 'any';
  const d = schedule[weekdayKey(date)];
  if (!d || !d.enabled) return 'closed';
  const start = toMinutes(d.start);
  let end = toMinutes(d.end);
  if (end <= start) end += 24 * 60;
  return [start, end];
}

/** Specialist ∩ location — the same rule availability applies. */
function intersect(a: Window, b: Window): [number, number] | null {
  if (a === 'closed' || b === 'closed') return null;
  if (a === 'any' && b === 'any') return [10 * 60, 19 * 60];
  if (a === 'any') return b as [number, number];
  if (b === 'any') return a;
  const s = Math.max(a[0], b[0]);
  const e = Math.min(a[1], b[1]);
  return e - s >= 30 ? [s, e] : null;
}

/** Mirrors formatWhen in BookingNotifier — the bell shows exactly this. */
function formatWhen(d: Date): string {
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

interface SeededService {
  spec: DemoService;
  id: string;
}

interface SeededSpecialist {
  key: string;
  id: string;
  name: string;
  active: boolean;
  locationId: string;
  schedule: Week;
  /** Every branch they work at (home first), with the hours there. */
  branches: { locationId: string; schedule: Week }[];
  serviceIds: string[];
  timeOff: { startAt: Date; endAt: Date }[];
}

interface UserRow {
  id: string;
  name: string;
  role: 'admin' | 'manager';
  locationId: string | null;
}

interface BookingDraft {
  id: string;
  locationId: string;
  specialist: SeededSpecialist | null;
  service: SeededService;
  client: Person | null;
  clientName: string;
  startAt: Date;
  endAt: Date;
  status: BookingStatus;
  source: BookingSource;
  notes: string | null;
  locale: string | null;
  createdAt: Date;
  createdById: string | null;
  /** The price unit in force for this visit (snapshotted onto the booking). */
  price: BookedPrice;
  finalPrice: number | null;
}

/** A resolved price unit, as a booking snapshots it. */
interface BookedPrice {
  price: number;
  priceMax: number | null;
  priceType: 'fixed' | 'range';
}

interface NotificationDraft {
  type: NotificationType;
  title: string;
  body: string;
  data: Prisma.InputJsonValue;
  createdAt: Date;
  read: boolean;
  /** Recipients: admins, plus managers of this branch (null = admins only). */
  locationId: string | null;
  skipUserId?: string | null;
}

async function seedPartner(spec: DemoPartner, ctx: Ctx): Promise<Summary> {
  const r = rng(spec.slug ?? spec.name);
  const partnerId = newId();
  const now = Date.now();
  const createdAt = new Date(daysFromNow(-spec.createdDaysAgo).getTime() - r.int(0, 8 * 60) * MINUTE);
  const counts: Record<string, number> = {};
  const notifications: NotificationDraft[] = [];
  const grants = new Map(spec.products.map((p) => [p.key, p]));
  const coursesOn = grants.has('courses') && grants.get('courses')!.status !== 'suspended';

  // ── Presentation imagery ──
  const p = spec.presentation;
  const logoUrl = p.logo ? await storeSvg(partnerId, logoSvg(p.logo.text, spec.accent, p.logo.style), 'logo', 90) : '';
  const gallery: Prisma.InputJsonValue[] = [];
  for (const [i, g] of (p.gallery ?? []).entries()) {
    const svg = interiorSvg(g.motif, spec.accent, `${spec.name}:gallery:${i}`, { sign: spec.name });
    gallery.push({ type: 'simple', url: await storeSvg(partnerId, svg, 'ph'), label: g.label });
  }
  const works: Prisma.InputJsonValue[] = [];
  for (const [i, w] of (p.works ?? []).entries()) {
    const seed = `${spec.name}:works:${i}`;
    if (w.beforeAfter) {
      works.push({
        type: 'beforeAfter',
        beforeUrl: await storeSvg(partnerId, workSvg(w.motif, spec.accent, seed, true), 'ph'),
        afterUrl: await storeSvg(partnerId, workSvg(w.motif, spec.accent, seed), 'ph'),
        label: w.label,
      });
    } else {
      works.push({ type: 'simple', url: await storeSvg(partnerId, workSvg(w.motif, spec.accent, seed), 'ph'), label: w.label });
    }
  }

  // ── Partner + presentation ──
  await prisma.partner.create({
    data: {
      id: partnerId,
      slug: spec.slug,
      name: spec.name,
      nameI18n: json(spec.nameI18n),
      type: spec.type,
      typeI18n: json(spec.typeI18n),
      kind: spec.kind,
      template: spec.template ?? 'classic',
      supportWidget: spec.supportWidget ?? 'support',
      defaultLocale: spec.defaultLocale ?? 'hy',
      accent: spec.accent,
      autoConfirmBookings: spec.autoConfirmBookings ?? false,
      bookingsEnabled: spec.bookingsEnabled ?? true,
      marketplaceListed: spec.marketplaceListed ?? false,
      // Legacy column the app still reads; kept in step with the grant below.
      coursesEnabled: coursesOn,
      active: spec.active ?? true,
      createdAt,
      presentation: {
        create: {
          tagline: p.tagline ?? '',
          taglineI18n: json(p.taglineI18n),
          about: p.about ?? '',
          aboutI18n: json(p.aboutI18n),
          logoUrl,
          hours: p.hours ?? '',
          instagram: p.instagram ?? '',
          facebook: p.facebook ?? '',
          whatsapp: p.whatsapp ?? '',
          heroTints: p.heroTints ?? [],
          gallery,
          works,
        },
      },
    },
  });

  // ── Product grants ──
  for (const g of spec.products) {
    const status = g.status ?? 'active';
    await prisma.partnerProduct.create({
      data: {
        id: newId(),
        partnerId,
        productKey: g.key,
        status,
        trialEndsAt: status === 'trialing' ? daysFromNow(g.trialDays ?? 14) : null,
        disabledAt: status === 'suspended' ? daysFromNow(-(g.suspendedDaysAgo ?? 7)) : null,
        enabledById: g.byStaff ? ctx.owner.id : null,
        enabledAt: g.byStaff ? new Date(createdAt.getTime() + 3 * DAY) : createdAt,
        // Branch & specialist pricing is switched on per partner (console).
        ...(g.key === 'bookings' && spec.branchPricing ? { settings: { branchPricing: true } } : {}),
        createdAt,
      },
    });
  }

  // ── Locations ──
  const locIds = new Map<string, string>();
  const locHours = new Map<string, Week | null>();
  for (const l of spec.locations) {
    const id = newId();
    locIds.set(l.key, id);
    locHours.set(id, l.hours);
    await prisma.location.create({
      data: {
        id,
        partnerId,
        name: l.name,
        nameI18n: json(l.nameI18n),
        address: l.address,
        phone: l.phone,
        areaKey: l.areaKey,
        lat: l.lat ?? null,
        lng: l.lng ?? null,
        hours: (l.hours ?? {}) as Prisma.InputJsonValue,
        createdAt,
      },
    });
  }
  counts.locations = spec.locations.length;

  // ── Staff ──
  const users: UserRow[] = spec.users.map((u) => ({
    id: newId(),
    name: u.name,
    role: u.role,
    locationId: u.location ? locIds.get(u.location)! : null,
  }));
  await prisma.user.createMany({
    data: spec.users.map((u, i) => ({
      id: users[i].id,
      partnerId,
      name: u.name,
      email: u.email.toLowerCase(),
      phone: u.phone,
      role: u.role,
      locationId: users[i].locationId,
      passwordHash: ctx.hash,
      mustChangePassword: u.mustChangePassword ?? false,
      lastLogin: u.lastSeenHoursAgo == null ? null : hoursAgo(u.lastSeenHoursAgo + 0.5),
      lastSeenAt: u.lastSeenHoursAgo == null ? null : hoursAgo(u.lastSeenHoursAgo),
      createdAt,
    })),
  });
  const admin = users.find((u) => u.role === 'admin')!;
  const staffAt = (locationId: string) =>
    users.filter((u) => u.role === 'admin' || u.locationId === locationId);

  // ── Services ──
  const services: SeededService[] = (spec.services ?? []).map((s) => ({ spec: s, id: newId() }));
  if (services.length) {
    await prisma.service.createMany({
      data: services.map(({ spec: s, id }, sortOrder) => ({
        id,
        partnerId,
        name: s.name,
        nameI18n: json(s.nameI18n),
        category: s.category,
        categoryI18n: json(s.categoryI18n),
        priceType: unitType(s),
        price: s.price,
        priceMax: s.priceMax ?? null,
        hidePrice: s.hidePrice ?? false,
        duration: s.duration,
        repeatEveryDays: s.repeatEveryDays ?? null,
        requiresSpecialist: s.capacity == null,
        capacity: s.capacity ?? 1,
        active: s.active ?? true,
        sortOrder,
        createdAt,
      })),
    });
  }
  counts.services = services.length;
  const serviceByKey = new Map(services.map((s) => [s.spec.key, s]));

  // ── Specialists, their links, time off ──
  const specialists: SeededSpecialist[] = [];
  for (const sp of spec.specialists ?? []) {
    const id = newId();
    const keys =
      sp.services === 'all' ? services.filter((s) => s.spec.capacity == null).map((s) => s.spec.key) : sp.services;
    const serviceIds = keys.map((k) => {
      const svc = serviceByKey.get(k);
      if (!svc) throw new Error(`${spec.name}: specialist ${sp.key} references unknown service "${k}"`);
      return svc.id;
    });
    const avatarUrl = sp.avatar ? await storeSvg(partnerId, avatarSvg(`${spec.name}:${sp.key}`, spec.accent), 'av', 88) : '';
    const locationId = locIds.get(sp.location)!;
    await prisma.specialist.create({
      data: {
        id,
        partnerId,
        locationId,
        name: sp.name,
        nameI18n: json(sp.nameI18n),
        title: sp.title,
        titleI18n: json(sp.titleI18n),
        phone: sp.phone,
        active: sp.active ?? true,
        avatarUrl,
        schedule: sp.schedule as Prisma.InputJsonValue,
        createdAt,
        services: { create: serviceIds.map((serviceId) => ({ serviceId })) },
      },
    });
    const timeOff = (sp.timeOff ?? []).map((t) => {
      const allDay = !(t.from && t.to);
      const startAt = allDay ? dayStart(t.day) : at(t.day, 0, toMinutes(t.from!));
      const endAt = allDay ? dayStart(t.day + (t.days ?? 1)) : at(t.day, 0, toMinutes(t.to!));
      return { startAt, endAt, allDay, reason: t.reason };
    });
    if (timeOff.length) {
      await prisma.specialistTimeOff.createMany({
        data: timeOff.map((t) => ({
          id: newId(),
          specialistId: id,
          partnerId,
          startAt: t.startAt,
          endAt: t.endAt,
          allDay: t.allDay,
          reason: t.reason,
          createdById: admin.id,
          createdAt: daysFromNow(-r.int(1, 6)),
        })),
      });
    }
    specialists.push({
      key: sp.key,
      id,
      name: sp.name,
      active: sp.active ?? true,
      locationId,
      schedule: sp.schedule,
      branches: [
        { locationId, schedule: sp.schedule },
        ...(sp.alsoAt ?? []).map((a) => ({ locationId: locIds.get(a.location)!, schedule: a.schedule })),
      ],
      serviceIds,
      timeOff,
    });
  }
  counts.specialists = specialists.length;
  const specialistByKey = new Map(specialists.map((s) => [s.key, s]));

  // ── More branches per specialist, branch prices, specialist prices ──
  // (The home-branch link is written by the DB trigger with the specialist.)
  for (const sp of spec.specialists ?? []) {
    for (const extra of sp.alsoAt ?? []) {
      await prisma.specialistLocation.create({
        data: {
          specialistId: specialistByKey.get(sp.key)!.id,
          locationId: locIds.get(extra.location)!,
          partnerId,
          schedule: extra.schedule as Prisma.InputJsonValue,
          createdAt,
        },
      });
    }
  }
  type PriceUnit = { price?: number; priceMax?: number; priceType?: 'fixed' | 'range'; duration?: number };
  const branchPrice = new Map<string, PriceUnit & { capacity?: number }>();
  for (const b of spec.branchPrices ?? []) {
    const svc = serviceByKey.get(b.service)!;
    const locationId = locIds.get(b.location)!;
    branchPrice.set(`${locationId}|${svc.id}`, b);
    await prisma.locationService.create({
      data: {
        locationId,
        serviceId: svc.id,
        partnerId,
        offered: b.offered ?? true,
        priceType: b.price != null ? unitType(b) : null,
        price: b.price ?? null,
        priceMax: b.priceMax ?? null,
        duration: b.duration ?? null,
        capacity: b.capacity ?? null,
      },
    });
  }
  const ownPrice = new Map<string, PriceUnit>();
  for (const o of spec.specialistPrices ?? []) {
    const svc = serviceByKey.get(o.service)!;
    const specialistId = specialistByKey.get(o.specialist)!.id;
    const locationId = locIds.get(o.location)!;
    ownPrice.set(`${specialistId}|${locationId}|${svc.id}`, o);
    await prisma.specialistPrice.create({
      data: {
        specialistId,
        locationId,
        serviceId: svc.id,
        partnerId,
        priceType: o.price != null ? unitType(o) : null,
        price: o.price ?? null,
        priceMax: o.priceMax ?? null,
        duration: o.duration ?? null,
      },
    });
  }
  /** What a seeded booking costs: own price at the branch → branch → default. */
  const bookedPrice = (svc: SeededService, locationId: string, specialistId?: string | null): BookedPrice => {
    const own = specialistId ? ownPrice.get(`${specialistId}|${locationId}|${svc.id}`) : undefined;
    const branch = branchPrice.get(`${locationId}|${svc.id}`);
    const hit: PriceUnit = own?.price != null ? own : branch?.price != null ? branch : svc.spec;
    const priceType = unitType(hit);
    return { price: hit.price!, priceMax: priceType === 'range' ? (hit.priceMax ?? null) : null, priceType };
  };

  // ── Bookings + clients ──
  if (spec.bookings && specialists.length) {
    const offeredAt = (locationId: string, serviceId: string) =>
      !(spec.branchPrices ?? []).some(
        (b) => b.offered === false && locIds.get(b.location) === locationId && serviceByKey.get(b.service)?.id === serviceId,
      );
    // Own duration at the branch → branch duration → the service's.
    const durationOf = (svc: SeededService, locationId: string, specialistId: string | null) =>
      (specialistId ? ownPrice.get(`${specialistId}|${locationId}|${svc.id}`)?.duration : undefined) ??
      branchPrice.get(`${locationId}|${svc.id}`)?.duration ??
      svc.spec.duration;
    const capacityOf = (svc: SeededService, locationId: string) =>
      branchPrice.get(`${locationId}|${svc.id}`)?.capacity ?? svc.spec.capacity ?? 1;
    const drafts = planBookings(spec, r, {
      createdAt, services, specialists, locHours, users, now, offeredAt, durationOf, capacityOf, priceOf: bookedPrice,
    });
    const clientRows = new Map<string, { person: Person; id: string; firstAt: Date }>();
    for (const b of drafts) {
      if (!b.client) continue;
      const row = clientRows.get(b.client.phone);
      if (!row) clientRows.set(b.client.phone, { person: b.client, id: newId(), firstAt: b.createdAt });
      else if (b.createdAt < row.firstAt) row.firstAt = b.createdAt;
    }
    await prisma.client.createMany({
      data: [...clientRows.values()].map((c) => ({
        id: c.id,
        partnerId,
        name: c.person.name,
        phone: c.person.phone,
        email: c.person.email ?? null,
        notes: c.person.notes ?? null,
        createdAt: later(c.firstAt, createdAt),
      })),
    });
    for (let i = 0; i < drafts.length; i += 500) {
      await prisma.booking.createMany({
        data: drafts.slice(i, i + 500).map((b) => ({
          id: b.id,
          partnerId,
          locationId: b.locationId,
          specialistId: b.specialist?.id ?? null,
          serviceId: b.service.id,
          clientId: b.client ? clientRows.get(b.client.phone)!.id : null,
          clientName: b.clientName,
          clientPhone: b.client?.phone ?? '',
          startAt: b.startAt,
          endAt: b.endAt,
          status: b.status,
          source: b.source,
          notes: b.notes,
          locale: b.locale,
          priceAtBooking: b.price.price,
          priceMaxAtBooking: b.price.priceMax,
          priceTypeAtBooking: b.price.priceType,
          finalPrice: b.finalPrice,
          createdById: b.createdById,
          createdAt: b.createdAt,
        })),
      });
    }
    counts.bookings = drafts.length;
    counts.clients = clientRows.size;
    notifications.push(...bookingNotifications(drafts, r, now, spec.autoConfirmBookings ?? false));
  }

  // ── Reviews (they also drive the stored marketplace rating) ──
  let ratingSum = 0;
  let ratingCount = 0;
  for (const sp of spec.specialists ?? []) {
    const n = sp.reviews ?? 0;
    if (!n) continue;
    const seeded = specialistByKey.get(sp.key)!;
    const reviews = Array.from({ length: n }, () => {
      const rating = r.weighted([[5, 66], [4, 24], [3, 6], [2, 3], [1, 1]] as const);
      return {
        id: newId(),
        specialistId: seeded.id,
        partnerId,
        author: r.pick(REVIEW_AUTHORS),
        rating,
        text: r.pick(REVIEW_TEXT[rating]),
        createdAt: later(new Date(now - r.int(1, 120) * DAY - r.int(0, 600) * MINUTE), createdAt),
      };
    });
    await prisma.specialistReview.createMany({ data: reviews });
    if (seeded.active) {
      ratingSum += reviews.reduce((s, x) => s + x.rating, 0);
      ratingCount += reviews.length;
    }
    counts.reviews = (counts.reviews ?? 0) + n;
  }
  // The marketplace card reads the stored columns while the partner page
  // computes from reviews, so store exactly what the page would compute.
  await prisma.partnerPresentation.update({
    where: { partnerId },
    data: {
      rating: ratingCount ? Math.round((ratingSum / ratingCount) * 10) / 10 : 0,
      reviews: ratingCount,
    },
  });

  // ── Courses ──
  for (const [ci, c] of (spec.courses ?? []).entries()) {
    const courseId = newId();
    const courseCreated = later(daysFromNow(-c.createdDaysAgo), createdAt);
    const price = c.priceMode === 'paid' ? (c.price ?? 0) : 0;
    const coverUrl = c.cover ? await storeSvg(partnerId, coverSvg(c.cover, spec.accent, `${spec.name}:course:${ci}`), 'course') : '';
    const tutor = c.tutor;
    await prisma.course.create({
      data: {
        id: courseId,
        partnerId,
        title: c.title,
        titleI18n: json(c.titleI18n),
        summary: c.summary,
        summaryI18n: json(c.summaryI18n),
        description: c.description,
        descriptionI18n: json(c.descriptionI18n),
        coverUrl,
        priceMode: c.priceMode,
        price,
        tutorSpecialistId: tutor && 'specialist' in tutor ? specialistByKey.get(tutor.specialist)!.id : null,
        tutorName: tutor && 'name' in tutor ? tutor.name : '',
        tutorTitle: tutor && 'name' in tutor ? tutor.title : '',
        level: c.level,
        active: c.active,
        createdAt: courseCreated,
      },
    });

    // Archived runs first, so the live run is the newest (CohortsService picks it).
    const runs: { run: DemoRun; created: Date }[] = [];
    let cursor = courseCreated;
    for (const run of c.history ?? []) {
      const created = later(run.startInDays == null ? cursor : daysFromNow(run.startInDays - 25), cursor);
      runs.push({ run, created });
      cursor = new Date(
        (run.startInDays == null ? created : daysFromNow(run.startInDays + (run.lengthDays ?? 0))).getTime() + DAY,
      );
    }
    runs.push({ run: c.current, created: earlier(later(cursor, courseCreated), new Date(now - HOUR)) });

    const pool = rng(`${spec.name}:course:${ci}`).shuffle(MEMBERS);
    let poolIndex = 0;
    for (const { run, created } of runs) {
      const cohortId = newId();
      const startDate = run.startInDays == null ? null : dayStart(run.startInDays);
      const endDate =
        run.startInDays == null || run.lengthDays == null ? null : dayStart(run.startInDays + run.lengthDays);
      await prisma.courseCohort.create({
        data: {
          id: cohortId,
          courseId,
          partnerId,
          locationId: run.location ? locIds.get(run.location)! : null,
          startDate,
          endDate,
          scheduleText: run.scheduleText,
          capacity: run.capacity,
          status: run.status,
          registrationOpen: run.registrationOpen,
          createdAt: created,
        },
      });
      const members = run.members.map((m) => {
        const person = pool[poolIndex++ % pool.length];
        const joined = later(new Date(now - m.daysAgo * DAY - r.int(10, 600) * MINUTE), created);
        return {
          id: newId(),
          cohortId,
          partnerId,
          memberName: person.name,
          memberPhone: person.phone,
          memberEmail: person.email ?? '',
          status: m.status,
          source: m.source,
          notes: m.source === 'backoffice' && r.chance(0.5) ? 'Paid in cash at the front desk' : null,
          priceAtEnroll: price,
          locale: m.source === 'public' ? r.weighted([['hy', 6], ['ru', 3], ['en', 2]] as const) : null,
          createdById: m.source === 'backoffice' ? admin.id : null,
          createdAt: joined,
        };
      });
      if (members.length) await prisma.courseEnrollment.createMany({ data: members });
      counts.enrollments = (counts.enrollments ?? 0) + members.length;

      // A self-registration rings the admins' bell (BookingNotifier.notifyEnrollment).
      if (run === c.current) {
        for (const m of members.filter((x) => x.status === 'pending' && x.source === 'public')) {
          notifications.push({
            type: 'course_registration',
            title: 'New course registration',
            body: `${m.memberName} · ${c.title}`,
            data: { courseId, courseTitle: c.title, memberName: m.memberName },
            createdAt: m.createdAt,
            read: false,
            locationId: null,
          });
        }
      }
    }
    counts.courses = (counts.courses ?? 0) + 1;
  }

  // ── Vacancies + applications ──
  for (const [vi, v] of (spec.vacancies ?? []).entries()) {
    const vacancyId = newId();
    const locationId = locIds.get(v.location)!;
    const publishedAt =
      v.state === 'draft' ? null : new Date(now - (v.publishedDaysAgo ?? 3) * DAY - r.int(0, 600) * MINUTE);
    const expiresAt = publishedAt ? new Date(publishedAt.getTime() + LISTING_TTL_DAYS * DAY) : null;
    const closedAt = v.state === 'closed' ? daysFromNow(-3) : null;
    const coverUrl = v.cover ? await storeSvg(partnerId, coverSvg(v.cover, spec.accent, `${spec.name}:vacancy:${vi}`), 'cover') : '';
    await prisma.vacancy.create({
      data: {
        id: vacancyId,
        partnerId,
        locationId,
        specialtyKey: v.specialtyKey,
        title: v.title ?? '',
        titleI18n: json(v.titleI18n),
        description: v.description,
        descriptionI18n: json(v.descriptionI18n),
        coverUrl,
        seats: v.seats ?? 1,
        payType: v.payType,
        salonPercent: v.salonPercent ?? null,
        salonPercentMax: v.salonPercentMax ?? null,
        amount: v.amount ?? null,
        amountMax: v.amountMax ?? null,
        payPeriod: v.payPeriod ?? 'month',
        scheduleType: v.scheduleType ?? null,
        scheduleNote: v.scheduleNote ?? '',
        experience: v.experience,
        perks: v.perks,
        applyMode: v.applyMode,
        contactPhone: v.contactPhone ?? '',
        // An expired listing is stored as published with its clock run out.
        status: v.state === 'expired' ? 'published' : v.state,
        publishedAt,
        expiresAt,
        closedAt,
        createdById: admin.id,
        createdAt: publishedAt ? new Date(publishedAt.getTime() - r.int(1, 30) * HOUR) : daysFromNow(-r.int(1, 3)),
      },
    });
    counts.vacancies = (counts.vacancies ?? 0) + 1;

    if (!publishedAt || !v.applicants) continue;
    const role = v.title || ctx.roleNames.get(v.specialtyKey) || v.specialtyKey;
    const openUntil = Math.min(now, (closedAt ?? expiresAt!).getTime());
    const linked = ctx.pros.length ? (v.applicants >= 3 ? 2 : 1) : 0;
    const strangers = rng(`${spec.name}:applicants:${vi}`).shuffle(APPLICANTS);
    for (let i = 0; i < v.applicants; i++) {
      // The first one or two are signed-in professionals, so "My applications"
      // in the vacancies app has something to show; the rest applied anonymously.
      const pro = i < linked ? ctx.pros[ctx.proCursor++ % ctx.pros.length] : null;
      const who = pro
        ? { name: pro.name, phone: pro.phone, email: pro.email ?? '', locale: pro.locale, note: 'Applied from my Reserva profile — my portfolio is there.' }
        : { ...strangers[i - linked], email: strangers[i - linked].email ?? '' };
      const appliedAt = new Date(publishedAt.getTime() + r.next() * (openUntil - publishedAt.getTime()));
      const fresh = now - appliedAt.getTime() < DAY;
      const status: VacancyApplicationStatus =
        v.state === 'closed'
          ? i === 0 ? 'shortlisted' : 'rejected'
          : fresh
            ? 'new'
            : r.weighted([['new', 40], ['contacted', 25], ['shortlisted', 18], ['rejected', 17]] as const);
      const applicationId = newId();
      await prisma.vacancyApplication.create({
        data: {
          id: applicationId,
          vacancyId,
          name: who.name,
          phone: who.phone,
          email: who.email,
          note: who.note,
          locale: who.locale,
          source: 'board',
          status,
          seenAt: status === 'new' ? null : new Date(Math.min(now, appliedAt.getTime() + r.int(1, 30) * HOUR)),
          professionalId: pro?.id ?? null,
          createdAt: appliedAt,
        },
      });
      counts.applications = (counts.applications ?? 0) + 1;
      if (status === 'new') {
        notifications.push({
          type: 'vacancy_application',
          title: 'New application',
          body: `${who.name} · ${role}`,
          data: { vacancyId, applicationId, applicantName: who.name, role },
          createdAt: appliedAt,
          read: false,
          locationId,
        });
      }
    }
  }

  // ── The bell ──
  const rows: Prisma.NotificationCreateManyInput[] = [];
  for (const n of notifications) {
    const recipients = n.locationId ? staffAt(n.locationId) : users.filter((u) => u.role === 'admin');
    for (const u of recipients) {
      if (n.skipUserId && u.id === n.skipUserId) continue;
      rows.push({
        id: newId(),
        userId: u.id,
        partnerId,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data,
        read: n.read,
        createdAt: n.createdAt,
      });
    }
  }
  if (rows.length) await prisma.notification.createMany({ data: rows });
  counts.notifications = rows.length;

  // ── Support chat ──
  if (spec.support) {
    const messages = [...spec.support.messages].sort((a, b) => b.minutesAgo - a.minutesAgo);
    const threadId = newId();
    await prisma.supportThread.create({
      data: {
        id: threadId,
        partnerId,
        status: spec.support.status,
        lastMessageAt: minutesAgo(messages[messages.length - 1].minutesAgo),
        partnerUnread: messages.filter((m) => m.from === 'platform' && !m.read).length,
        platformUnread: messages.filter((m) => m.from === 'partner' && !m.read).length,
        createdAt: minutesAgo(messages[0].minutesAgo),
        messages: {
          create: messages.map((m) => ({
            id: newId(),
            senderType: m.from,
            senderUserId: m.from === 'partner' ? admin.id : ctx.owner.id,
            senderName: m.from === 'partner' ? admin.name : ctx.owner.name,
            body: m.text,
            readAt: m.read ? minutesAgo(Math.max(0, m.minutesAgo - 7)) : null,
            createdAt: minutesAgo(m.minutesAgo),
          })),
        },
      },
    });
  }

  return { spec, counts };
}

/**
 * Lay out appointments inside each specialist's real working window (their
 * schedule ∩ the branch's hours, overnight shifts included), skipping time off
 * and never overlapping — the database's EXCLUDE constraint would refuse it
 * anyway. Statuses follow the clock: finished visits are completed / cancelled
 * / no-show, upcoming ones confirmed or pending.
 */
function planBookings(
  spec: DemoPartner,
  r: Rng,
  ctx: {
    createdAt: Date;
    services: SeededService[];
    specialists: SeededSpecialist[];
    locHours: Map<string, Week | null>;
    users: UserRow[];
    now: number;
    /** Whether a branch offers a service (a branch can switch one off). */
    offeredAt: (locationId: string, serviceId: string) => boolean;
    /** How long a service takes there, with that specialist. */
    durationOf: (svc: SeededService, locationId: string, specialistId: string | null) => number;
    /** Concurrent guests a facility service takes at a branch. */
    capacityOf: (svc: SeededService, locationId: string) => number;
    /** What it costs there, with that specialist (own → branch → service). */
    priceOf: (svc: SeededService, locationId: string, specialistId: string | null) => BookedPrice;
  },
): BookingDraft[] {
  const plan = spec.bookings!;
  const { now } = ctx;
  const autoConfirm = spec.autoConfirmBookings ?? false;
  const customers = r.shuffle(CLIENTS).slice(0, plan.clients);
  // A third of the customer base are regulars and book far more often.
  const weightedCustomers = customers.map((c, i) => [c, i < customers.length / 3 ? 4 : 1] as const);
  const drafts: BookingDraft[] = [];

  const draft = (
    locationId: string,
    specialist: SeededSpecialist | null,
    service: SeededService,
    startAt: Date,
  ): BookingDraft => {
    const endAt = new Date(startAt.getTime() + ctx.durationOf(service, locationId, specialist?.id ?? null) * MINUTE);
    const online = r.chance(plan.publicShare);
    const source: BookingSource = online ? 'public' : 'backoffice';
    const walkIn = !online && r.chance(0.08);
    const client = walkIn ? null : r.weighted(weightedCustomers);

    let status: BookingStatus;
    if (endAt.getTime() <= now) {
      status = r.weighted([['completed', 80], ['cancelled', 11], ['noshow', 9]] as const);
    } else if (startAt.getTime() <= now) {
      status = 'confirmed';
    } else if (autoConfirm || !online) {
      status = r.weighted([['confirmed', 92], ['cancelled', 8]] as const);
    } else {
      status = r.weighted([['confirmed', 58], ['pending', 34], ['cancelled', 8]] as const);
    }

    // Made some time before the visit; never in the future, never before the partner existed.
    const lead = r.int(2 * 60, 10 * 24 * 60);
    let createdAt = new Date(Math.min(startAt.getTime() - lead * MINUTE, now - r.int(5, 5 * 24 * 60) * MINUTE));
    createdAt = later(createdAt, new Date(ctx.createdAt.getTime() + HOUR));

    const price = ctx.priceOf(service, locationId, specialist?.id ?? null);
    const staff = ctx.users.filter((u) => u.role === 'admin' || u.locationId === locationId);
    return {
      id: newId(),
      locationId,
      specialist,
      service,
      client,
      clientName: client?.name ?? r.pick(WALK_INS),
      startAt,
      endAt,
      status,
      source,
      notes: r.chance(0.1) ? r.pick(BOOKING_NOTES) : null,
      locale: online ? r.weighted([['hy', 60], ['ru', 25], ['en', 15]] as const) : null,
      createdAt,
      createdById: online ? null : r.pick(staff).id,
      price,
      // Staff settle a range price after the visit: inside the range, or a
      // little above the floor of an open-ended "from X".
      finalPrice:
        status === 'completed' && price.priceType === 'range'
          ? Math.round((price.price + r.next() * ((price.priceMax ?? price.price * 1.6) - price.price)) / 1000) * 1000
          : null,
    };
  };

  // Specialist appointments.
  for (const sp of ctx.specialists.filter((s) => s.active)) {
    // One person can't be in two places at once: track their bookings across
    // every branch they work at (the DB's overlap guard would refuse it).
    const taken: [number, number][] = [];
    for (const branch of sp.branches) {
      const offered = ctx.services.filter(
        (s) => sp.serviceIds.includes(s.id) && (s.spec.active ?? true) && ctx.offeredAt(branch.locationId, s.id),
      );
      if (!offered.length) continue;
      for (let day = plan.fromDay; day <= plan.toDay; day++) {
        const date = dayStart(day);
        const win = intersect(dayWindow(branch.schedule, date), dayWindow(ctx.locHours.get(branch.locationId), date));
        if (!win) continue;
        const want = r.int(plan.perDay[0], plan.perDay[1]);
        let cursor = win[0] + r.pick([0, 0, 0, 15, 30, 60]);
        let made = 0;
        for (let guard = 0; made < want && guard < 30; guard++) {
          const service = r.pick(offered);
          const end = cursor + ctx.durationOf(service, branch.locationId, sp.id);
          if (end > win[1]) break;
          const startAt = at(day, 0, cursor);
          const endAt = at(day, 0, end);
          if (
            sp.timeOff.some((o) => startAt < o.endAt && endAt > o.startAt) ||
            taken.some(([s, e]) => startAt.getTime() < e && endAt.getTime() > s)
          ) {
            cursor = end + 15;
            continue;
          }
          drafts.push(draft(branch.locationId, sp, service, startAt));
          taken.push([startAt.getTime(), endAt.getTime()]);
          made++;
          cursor = end + r.pick([0, 0, 15, 15, 30, 30, 45, 60, 90, 120]);
        }
      }
    }
  }

  // Facility visits (no specialist): random starts, never above the service capacity.
  const facilities = ctx.services.filter((s) => s.spec.capacity != null && (s.spec.active ?? true));
  if (plan.facilityPerDay && facilities.length) {
    for (const [locationId, hours] of ctx.locHours) {
      for (let day = plan.fromDay; day <= plan.toDay; day++) {
        const win = intersect(dayWindow(hours, dayStart(day)), 'any');
        if (!win) continue;
        const want = r.int(plan.facilityPerDay[0], plan.facilityPerDay[1]);
        // Only what this branch offers (a branch can switch the sauna off).
        const here = facilities.filter((f) => ctx.offeredAt(locationId, f.id));
        if (!here.length) continue;
        for (let i = 0; i < want; i++) {
          const service = r.pick(here);
          const duration = ctx.durationOf(service, locationId, null);
          const slots = Math.floor((win[1] - win[0] - duration) / 30);
          if (slots < 0) continue;
          const start = win[0] + r.int(0, slots) * 30;
          const startAt = at(day, 0, start);
          const endAt = new Date(startAt.getTime() + duration * MINUTE);
          const busy = drafts.filter(
            (b) =>
              b.service.id === service.id &&
              b.locationId === locationId &&
              b.startAt < endAt &&
              b.endAt > startAt &&
              b.status !== 'cancelled' &&
              b.status !== 'noshow',
          ).length;
          if (busy >= ctx.capacityOf(service, locationId)) continue;
          drafts.push(draft(locationId, null, service, startAt));
        }
      }
    }
  }

  return drafts;
}

/** Bell entries for the booking activity a salon would actually have seen lately. */
function bookingNotifications(drafts: BookingDraft[], r: Rng, now: number, autoConfirm: boolean): NotificationDraft[] {
  const out: NotificationDraft[] = [];
  const note = (
    type: NotificationType,
    title: string,
    b: BookingDraft,
    createdAt: Date,
    read: boolean,
    skipUserId: string | null = null,
  ) => {
    const svc = b.service.spec.name;
    const withSp = b.specialist ? ` with ${b.specialist.name}` : '';
    out.push({
      type,
      title,
      body: `${b.clientName} · ${svc}${withSp} · ${formatWhen(b.startAt)}`,
      data: {
        bookingId: b.id,
        clientName: b.clientName,
        service: svc,
        specialist: b.specialist?.name ?? null,
        startAt: b.startAt.toISOString(),
      },
      createdAt,
      read,
      locationId: b.locationId,
      skipUserId,
    });
  };

  // The latest bookings to come in.
  const recent = drafts
    .filter((b) => now - b.createdAt.getTime() < 4 * DAY)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 10);
  for (const b of recent) note('booking_created', 'New booking', b, b.createdAt, now - b.createdAt.getTime() > 20 * HOUR, b.createdById);

  const upcoming = drafts.filter((b) => b.startAt.getTime() > now);
  for (const b of upcoming.filter((x) => x.status === 'cancelled').slice(0, 3)) {
    note('booking_cancelled', 'Booking cancelled', b, new Date(Math.min(now - HOUR, b.createdAt.getTime() + r.int(2, 30) * HOUR)), r.chance(0.5));
  }
  const confirmed = upcoming.filter((x) => x.status === 'confirmed');
  if (confirmed[0]) note('booking_rescheduled', 'Booking rescheduled', confirmed[0], new Date(now - 3 * HOUR), false);
  if (!autoConfirm) {
    for (const b of confirmed.filter((x) => x.source === 'public').slice(1, 3)) {
      note('booking_confirmed', 'Booking confirmed', b, new Date(Math.min(now - 30 * MINUTE, b.createdAt.getTime() + 2 * HOUR)), true);
    }
  }
  return out;
}

// ══════════════════════════════════════════════════════════════
// Run
// ══════════════════════════════════════════════════════════════

async function main() {
  const roleNames = await preflight();
  const removed = await clean();
  if (CLEAN_ONLY) {
    console.log(`removed ${removed} demo partner(s), their uploads, pending signups, demo requests and visits`);
    return;
  }

  const hash = await new PasswordService().hash(DEMO_PASSWORD);
  const { owner } = await seedPlatformStaff(hash);
  const pros = await prisma.professional.findMany({
    where: { phone: { startsWith: PRO_PHONE_PREFIX }, deletedAt: null, active: true },
    select: { id: true, name: true, phone: true, email: true, locale: true },
    orderBy: { phone: 'asc' },
  });
  const ctx: Ctx = { hash, owner, pros, proCursor: 0, roleNames };

  const summaries: Summary[] = [];
  for (const spec of PARTNERS) {
    const s = await seedPartner(spec, ctx);
    summaries.push(s);
    const c = s.counts;
    console.log(
      `✓ ${spec.name.padEnd(20)} ${[
        c.bookings ? `${c.bookings} bookings` : '',
        c.clients ? `${c.clients} clients` : '',
        c.specialists ? `${c.specialists} specialists` : '',
        c.courses ? `${c.courses} courses` : '',
        c.vacancies ? `${c.vacancies} vacancies` : '',
        c.applications ? `${c.applications} applications` : '',
      ]
        .filter(Boolean)
        .join(' · ')}`,
    );
  }
  await seedDemoRequests(owner.id);
  await seedPendingSignups(hash);
  const visits = await seedVisits();
  console.log(`✓ platform: ${PLATFORM_STAFF.length} staff · ${DEMO_REQUESTS.length} demo requests · ${PENDING_SIGNUPS.length} pending signups · ${visits} visits`);
  if (!pros.length) {
    console.log('\n! No demo professionals found — run `pnpm seed:professionals` to link applicants to accounts.');
  }

  printCredentials(summaries);
}

function printCredentials(summaries: Summary[]) {
  const line = '─'.repeat(100);
  console.log(`\n${line}\nDEMO LOGINS — password for every account below: ${DEMO_PASSWORD}\n${line}`);
  console.log('\nInternal backoffice (http://localhost:5175)');
  for (const s of PLATFORM_STAFF) console.log(`  ${s.email.padEnd(28)} ${s.role}`);

  console.log('\nPartner backoffice (http://localhost:5173) — sign in with email OR phone');
  for (const { spec } of summaries) {
    console.log(`\n  ${spec.name}${spec.slug ? `  →  public page /p/${spec.slug}` : '  (no public page)'}`);
    console.log(`  ${spec.purpose}`);
    for (const u of spec.users) {
      const scope = u.role === 'manager' ? `manager · ${spec.locations.find((l) => l.key === u.location)?.name}` : 'admin';
      const extra = [
        spec.active === false ? 'partner deactivated' : '',
        u.mustChangePassword ? 'must change password on first login' : '',
      ]
        .filter(Boolean)
        .join('; ');
      console.log(`    ${u.email.padEnd(28)} ${u.phone.padEnd(14)} ${scope}${extra ? `  (${extra})` : ''}`);
    }
  }
  console.log(`\nVacancies board professionals (http://localhost:5176/login): +37455100001 … +37455100020 / testpassword1`);
  console.log(`${line}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
