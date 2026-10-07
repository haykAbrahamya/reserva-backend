import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { paginate, type Paginated } from '@/common/dto/pagination';
import { addDays, daysInclusive, eachDay } from './calendar-day';
import { audience, bookingsIn, eventsIn, yerevanMidnight, type Window } from './report-sql';
import type {
  AnalyticsEventsQuery,
  AnalyticsRangeQuery,
  AnalyticsSourcesQuery,
} from './dto/site-analytics-query.dto';
import type {
  AnalyticsBounds,
  AnalyticsCleared,
  AnalyticsEventRow,
  AnalyticsOverview,
  AnalyticsPartners,
  AnalyticsSources,
  AnalyticsStorage,
  Kpi,
  PartnerRow,
  Range,
} from './site-analytics.types';

// Time windows, audience and the rest of the shared SQL rules: report-sql.ts.

/**
 * Booking conversion (contract §9): of the sessions that viewed a partner's
 * page, the share that also booked there — one tracked population on both
 * sides, never DB bookings over tracked visitors. The query counts booked
 * sessions only among viewing ones, so the ratio cannot pass 1; the clamp
 * keeps that promise even if a caller ever feeds it otherwise.
 */
export function conversion(bookedSessions: number, viewSessions: number): number | null {
  if (!(viewSessions > 0)) return null;
  return Math.round((Math.min(bookedSessions, viewSessions) / viewSessions) * 10_000) / 10_000;
}

interface EventKpis {
  visitors: number;
  sessions: number;
  pageViews: number;
  partnerViews: number;
  bookClicks: number;
  bookingOpens: number;
  contactClicks: number;
  signupViews: number;
  signupStarts: number;
}

interface StoredKpis {
  bookings: number;
  signups: number;
  activations: number;
}

interface PartnerAggregate {
  partnerId: string;
  name: string;
  slug: string | null;
  views: number;
  visitors: number;
  bookClicks: number;
  bookingOpens: number;
  bookings: number;
  call: number;
  whatsapp: number;
  instagram: number;
  directions: number;
  otherContacts: number;
  /** Sessions with a page_view on the partner. */
  viewSessions: number;
  /** Of those, sessions that also have a booking_success there. */
  bookedSessions: number;
}

interface PartnerTotals {
  visitors: number;
  viewSessions: number;
  bookedSessions: number;
}

interface EventLogRow {
  id: string;
  name: string;
  createdAt: Date;
  path: string | null;
  host: string | null;
  props: Record<string, unknown> | null;
  partnerId: string | null;
  partnerName: string | null;
  partnerSlug: string | null;
  sessionId: string;
  visitorId: string;
  channel: string;
  deviceType: string | null;
  browser: string | null;
  os: string | null;
  country: string | null;
  city: string | null;
  language: string | null;
  referrerHost: string | null;
  utmCampaign: string | null;
  isInternal: boolean;
}

/** Internal-console reports over the public-site analytics (/platform/analytics/*). */
@Injectable()
export class SiteAnalyticsService {
  private readonly logger = new Logger('SiteAnalytics');

  constructor(private readonly prisma: PrismaService) {}

  async overview(q: AnalyticsRangeQuery): Promise<AnalyticsOverview> {
    const range = toRange(q);
    // The equally long period that ends the day before `from`.
    const prev: Window = { from: addDays(q.from, -range.days), to: addDays(q.from, -1) };

    const [now, before, stored, storedBefore, daily, bookingsDaily, contacts, partners] =
      await Promise.all([
        this.eventKpis(q, q.includeInternal),
        this.eventKpis(prev, q.includeInternal),
        this.storedKpis(q),
        this.storedKpis(prev),
        this.dailyTraffic(q, q.includeInternal),
        this.dailyBookings(q),
        this.contactChannels(q, q.includeInternal),
        this.partnerAggregates(q, q.includeInternal),
      ]);

    const kpi = (value: number, prevValue: number): Kpi => ({ value, prev: prevValue });
    const traffic = new Map(daily.map((d) => [d.date, d]));
    const booked = new Map(bookingsDaily.map((d) => [d.date, d.bookings]));

    return {
      range,
      kpis: {
        visitors: kpi(now.visitors, before.visitors),
        sessions: kpi(now.sessions, before.sessions),
        pageViews: kpi(now.pageViews, before.pageViews),
        partnerViews: kpi(now.partnerViews, before.partnerViews),
        bookClicks: kpi(now.bookClicks, before.bookClicks),
        bookingOpens: kpi(now.bookingOpens, before.bookingOpens),
        bookings: kpi(stored.bookings, storedBefore.bookings),
        contactClicks: kpi(now.contactClicks, before.contactClicks),
        signupViews: kpi(now.signupViews, before.signupViews),
        signupStarts: kpi(now.signupStarts, before.signupStarts),
        signups: kpi(stored.signups, storedBefore.signups),
        activations: kpi(stored.activations, storedBefore.activations),
      },
      series: eachDay(range.from, range.to).map((date) => ({
        date,
        visitors: traffic.get(date)?.visitors ?? 0,
        sessions: traffic.get(date)?.sessions ?? 0,
        pageViews: traffic.get(date)?.pageViews ?? 0,
        bookings: booked.get(date) ?? 0,
      })),
      contacts,
      topPartners: partners.slice(0, 5).map(toPartnerRow),
    };
  }

  async partners(q: AnalyticsRangeQuery): Promise<AnalyticsPartners> {
    const [rows, all] = await Promise.all([
      this.partnerAggregates(q, q.includeInternal),
      this.partnerTotals(q, q.includeInternal),
    ]);
    const sum = (pick: (r: PartnerAggregate) => number) =>
      rows.reduce((total, r) => total + pick(r), 0);
    return {
      range: toRange(q),
      rows: rows.map(toPartnerRow),
      totals: {
        views: sum((r) => r.views),
        // Distinct across partners — one visitor browsing two salons is one visitor.
        visitors: all.visitors,
        bookClicks: sum((r) => r.bookClicks),
        bookingOpens: sum((r) => r.bookingOpens),
        bookings: sum((r) => r.bookings),
        conversion: conversion(all.bookedSessions, all.viewSessions),
        contacts: {
          call: sum((r) => r.call),
          whatsapp: sum((r) => r.whatsapp),
          instagram: sum((r) => r.instagram),
          directions: sum((r) => r.directions),
          other: sum((r) => r.otherContacts),
        },
      },
    };
  }

  async sources(q: AnalyticsSourcesQuery): Promise<AnalyticsSources> {
    // Sessions with an event in range (on the partner, when one is given).
    const sessions = Prisma.sql`
      FROM "site_sessions" s
      WHERE ${audience(q.includeInternal)}
        AND s."id" IN (
          SELECT e."sessionId" FROM "site_events" e
          WHERE ${eventsIn(q)}
          ${q.partnerId ? Prisma.sql`AND e."partnerId" = ${q.partnerId}` : Prisma.empty}
        )`;

    const [channels, referrers, campaigns, devices, countries, languages] = await Promise.all([
      this.prisma.$queryRaw<AnalyticsSources['channels']>`
        SELECT s."channel", count(*)::int AS "sessions", count(DISTINCT s."visitorId")::int AS "visitors"
        ${sessions}
        GROUP BY s."channel"
        ORDER BY "sessions" DESC, s."channel"`,
      this.prisma.$queryRaw<AnalyticsSources['referrers']>`
        SELECT s."referrerHost" AS "host", count(*)::int AS "sessions"
        ${sessions} AND s."referrerHost" IS NOT NULL AND s."referrerHost" <> ''
        GROUP BY s."referrerHost"
        ORDER BY "sessions" DESC, s."referrerHost"
        LIMIT 20`,
      this.prisma.$queryRaw<AnalyticsSources['campaigns']>`
        SELECT s."utmSource" AS "source", s."utmMedium" AS "medium", s."utmCampaign" AS "campaign",
               count(*)::int AS "sessions"
        ${sessions} AND (s."utmSource" IS NOT NULL OR s."utmMedium" IS NOT NULL OR s."utmCampaign" IS NOT NULL)
        GROUP BY s."utmSource", s."utmMedium", s."utmCampaign"
        ORDER BY "sessions" DESC, s."utmSource", s."utmMedium", s."utmCampaign"
        LIMIT 20`,
      this.prisma.$queryRaw<AnalyticsSources['devices']>`
        SELECT COALESCE(s."deviceType", 'unknown') AS "deviceType", count(*)::int AS "sessions"
        ${sessions}
        GROUP BY 1
        ORDER BY "sessions" DESC, 1`,
      this.prisma.$queryRaw<AnalyticsSources['countries']>`
        SELECT COALESCE(s."country", 'unknown') AS "country", count(*)::int AS "sessions"
        ${sessions}
        GROUP BY 1
        ORDER BY "sessions" DESC, 1
        LIMIT 15`,
      // Primary subtag only: 'hy-AM', 'hy' and 'HY' are one audience.
      this.prisma.$queryRaw<AnalyticsSources['languages']>`
        SELECT COALESCE(NULLIF(lower(split_part(replace(s."language", '_', '-'), '-', 1)), ''), 'unknown') AS "language",
               count(*)::int AS "sessions"
        ${sessions}
        GROUP BY 1
        ORDER BY "sessions" DESC, 1
        LIMIT 10`,
    ]);

    return { range: toRange(q), channels, referrers, campaigns, devices, countries, languages };
  }

  async events(q: AnalyticsEventsQuery): Promise<Paginated<AnalyticsEventRow>> {
    const where = Prisma.sql`
      WHERE ${eventsIn(q)} AND ${audience(q.includeInternal)}
      ${q.name ? Prisma.sql`AND e."name" = ${q.name}` : Prisma.empty}
      ${q.partnerId ? Prisma.sql`AND e."partnerId" = ${q.partnerId}` : Prisma.empty}`;

    // Newest first. A batch's events share one server time, so the client
    // clock breaks the tie (it orders events within a batch), then the id.
    const [rows, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<EventLogRow[]>`
        SELECT e."id", e."name", e."createdAt", e."path", e."host", e."props",
               p."id" AS "partnerId", p."name" AS "partnerName", p."slug" AS "partnerSlug",
               s."id" AS "sessionId", s."visitorId", s."channel", s."deviceType", s."browser", s."os",
               s."country", s."city", s."language", s."referrerHost", s."utmCampaign", s."isInternal"
        FROM "site_events" e
        JOIN "site_sessions" s ON s."id" = e."sessionId"
        LEFT JOIN "partners" p ON p."id" = e."partnerId"
        ${where}
        ORDER BY e."createdAt" DESC, e."clientAt" DESC NULLS LAST, e."id" DESC
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS "total"
        FROM "site_events" e
        JOIN "site_sessions" s ON s."id" = e."sessionId"
        ${where}`,
    ]);

    return paginate(rows.map(toEventRow), total, q.page, q.pageSize);
  }

  /**
   * The Yerevan days of the first and last event, for the console's date
   * picker ("All time"). Bots are skipped, internal traffic is not. Ordered
   * index walks with LIMIT 1 rather than min()/max() over a join, so this
   * stays cheap however large the table grows.
   */
  async bounds(): Promise<AnalyticsBounds> {
    // A scalar subquery over no rows is NULL, so an empty table gives null/null.
    const [row] = await this.prisma.$queryRaw<AnalyticsBounds[]>`
      SELECT
        to_char(((
          SELECT e."createdAt" FROM "site_events" e JOIN "site_sessions" s ON s."id" = e."sessionId"
          WHERE NOT s."isBot" ORDER BY e."createdAt" ASC LIMIT 1
        ) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yerevan')::date, 'YYYY-MM-DD') AS "first",
        to_char(((
          SELECT e."createdAt" FROM "site_events" e JOIN "site_sessions" s ON s."id" = e."sessionId"
          WHERE NOT s."isBot" ORDER BY e."createdAt" DESC LIMIT 1
        ) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yerevan')::date, 'YYYY-MM-DD') AS "last"`;
    return { first: row?.first ?? null, last: row?.last ?? null };
  }

  /** What the analytics tables hold: rows, disk space, and the oldest day kept. */
  async storage(): Promise<AnalyticsStorage> {
    // float8, not bigint: Prisma returns bigint as BigInt, which JSON cannot carry.
    const [row] = await this.prisma.$queryRaw<AnalyticsStorage[]>`
      SELECT
        (SELECT count(*)::int FROM "site_events") AS "events",
        (SELECT count(*)::int FROM "site_sessions") AS "sessions",
        (pg_total_relation_size('site_events') + pg_total_relation_size('site_sessions'))::float8 AS "bytes",
        to_char(((
          SELECT e."createdAt" FROM "site_events" e ORDER BY e."createdAt" ASC LIMIT 1
        ) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yerevan')::date, 'YYYY-MM-DD') AS "oldest"`;
    return {
      events: row.events,
      sessions: row.sessions,
      bytes: row.bytes,
      oldest: row.oldest ?? null,
    };
  }

  /**
   * Delete analytics data, in one transaction: everything, or — with `before`
   * — the events created before that Yerevan day began, then the sessions
   * that are left without any event AND were last seen before that same
   * moment. The second condition keeps the cleanup inside the window being
   * deleted: a newer session is never touched, whatever state it is in.
   *
   * Only these two tables; visitor_events and the rest are never touched.
   * Postgres reuses the freed space for new rows; the files would only shrink
   * after a VACUUM FULL, which locks the tables, so none is run.
   */
  async clear(before: string | undefined, by: string): Promise<AnalyticsCleared> {
    const [events, sessions] = before
      ? await this.prisma.$transaction([
          this.prisma.$executeRaw`
            DELETE FROM "site_events" WHERE "createdAt" < ${yerevanMidnight(before)}`,
          this.prisma.$executeRaw`
            DELETE FROM "site_sessions" s
            WHERE s."lastSeenAt" < ${yerevanMidnight(before)}
              AND NOT EXISTS (SELECT 1 FROM "site_events" e WHERE e."sessionId" = s."id")`,
        ])
      : (
          await this.prisma.$transaction([
            this.prisma.siteEvent.deleteMany({}),
            this.prisma.siteSession.deleteMany({}),
          ])
        ).map((r) => r.count);
    // A destructive console action: leave a trace of who did what.
    this.logger.warn(
      `Platform user ${by} deleted ${events} event(s) and ${sessions} session(s) ${before ? `before ${before}` : '(everything)'}`,
    );
    return { events, sessions };
  }

  // ── Building blocks ──────────────────────────────────────────

  private async eventKpis(w: Window, includeInternal: boolean): Promise<EventKpis> {
    const [row] = await this.prisma.$queryRaw<EventKpis[]>`
      SELECT
        count(DISTINCT e."visitorId")::int AS "visitors",
        count(DISTINCT e."sessionId")::int AS "sessions",
        (count(*) FILTER (WHERE e."name" = 'page_view'))::int AS "pageViews",
        (count(*) FILTER (WHERE e."name" = 'page_view' AND e."partnerId" IS NOT NULL))::int AS "partnerViews",
        (count(*) FILTER (WHERE e."name" = 'book_click'))::int AS "bookClicks",
        (count(*) FILTER (WHERE e."name" = 'booking_open'))::int AS "bookingOpens",
        (count(*) FILTER (WHERE e."name" = 'contact_click'))::int AS "contactClicks",
        (count(*) FILTER (WHERE e."name" = 'page_view' AND e."props"->>'pt' = 'signup'))::int AS "signupViews",
        (count(*) FILTER (WHERE e."name" = 'signup_start'))::int AS "signupStarts"
      FROM "site_events" e
      JOIN "site_sessions" s ON s."id" = e."sessionId"
      WHERE ${eventsIn(w)} AND ${audience(includeInternal)}`;
    return row;
  }

  /** The numbers the tables of record own, not the client's events. */
  private async storedKpis(w: Window): Promise<StoredKpis> {
    const from = yerevanMidnight(w.from);
    const until = yerevanMidnight(addDays(w.to, 1));
    const [row] = await this.prisma.$queryRaw<StoredKpis[]>`
      SELECT
        (SELECT count(*)::int FROM "bookings" b WHERE b."source" = 'public' AND ${bookingsIn(w)}) AS "bookings",
        (SELECT count(*)::int FROM "pending_registrations" r
          WHERE r."createdAt" >= ${from} AND r."createdAt" < ${until}) AS "signups",
        (SELECT count(*)::int FROM "pending_registrations" r
          WHERE r."consumedAt" >= ${from} AND r."consumedAt" < ${until}) AS "activations"`;
    return row;
  }

  private dailyTraffic(w: Window, includeInternal: boolean) {
    return this.prisma.$queryRaw<
      { date: string; visitors: number; sessions: number; pageViews: number }[]
    >`
      SELECT to_char((e."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yerevan')::date, 'YYYY-MM-DD') AS "date",
             count(DISTINCT e."visitorId")::int AS "visitors",
             count(DISTINCT e."sessionId")::int AS "sessions",
             (count(*) FILTER (WHERE e."name" = 'page_view'))::int AS "pageViews"
      FROM "site_events" e
      JOIN "site_sessions" s ON s."id" = e."sessionId"
      WHERE ${eventsIn(w)} AND ${audience(includeInternal)}
      GROUP BY 1`;
  }

  private dailyBookings(w: Window) {
    return this.prisma.$queryRaw<{ date: string; bookings: number }[]>`
      SELECT to_char((b."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yerevan')::date, 'YYYY-MM-DD') AS "date",
             count(*)::int AS "bookings"
      FROM "bookings" b
      WHERE b."source" = 'public' AND ${bookingsIn(w)}
      GROUP BY 1`;
  }

  private contactChannels(w: Window, includeInternal: boolean) {
    return this.prisma.$queryRaw<{ channel: string; count: number }[]>`
      SELECT COALESCE(e."props"->>'ch', 'other') AS "channel", count(*)::int AS "count"
      FROM "site_events" e
      JOIN "site_sessions" s ON s."id" = e."sessionId"
      WHERE e."name" = 'contact_click' AND ${eventsIn(w)} AND ${audience(includeInternal)}
      GROUP BY 1
      ORDER BY "count" DESC, 1`;
  }

  /**
   * One row per partner with any event or public booking in range, most views
   * first. Conversion counts SESSIONS on the partner (`visits`): those with a
   * page_view, and of them, those with a booking_success too — so a booked
   * session is only ever counted among viewing ones and the ratio stays ≤ 1.
   */
  private partnerAggregates(w: Window, includeInternal: boolean) {
    return this.prisma.$queryRaw<PartnerAggregate[]>`
      WITH scoped AS (
        SELECT e."partnerId", e."sessionId", e."visitorId", e."name", e."props"
        FROM "site_events" e
        JOIN "site_sessions" s ON s."id" = e."sessionId"
        WHERE e."partnerId" IS NOT NULL AND ${eventsIn(w)} AND ${audience(includeInternal)}
      ),
      ev AS (
        SELECT "partnerId",
          (count(*) FILTER (WHERE "name" = 'page_view'))::int AS "views",
          count(DISTINCT "visitorId")::int AS "visitors",
          (count(*) FILTER (WHERE "name" = 'book_click'))::int AS "bookClicks",
          (count(*) FILTER (WHERE "name" = 'booking_open'))::int AS "bookingOpens",
          (count(*) FILTER (WHERE "name" = 'contact_click' AND "props"->>'ch' = 'call'))::int AS "call",
          (count(*) FILTER (WHERE "name" = 'contact_click' AND "props"->>'ch' = 'whatsapp'))::int AS "whatsapp",
          (count(*) FILTER (WHERE "name" = 'contact_click' AND "props"->>'ch' = 'instagram'))::int AS "instagram",
          (count(*) FILTER (WHERE "name" = 'contact_click' AND "props"->>'ch' = 'directions'))::int AS "directions",
          (count(*) FILTER (
            WHERE "name" = 'contact_click'
              AND COALESCE("props"->>'ch', '') NOT IN ('call', 'whatsapp', 'instagram', 'directions')
          ))::int AS "otherContacts"
        FROM scoped
        GROUP BY "partnerId"
      ),
      visits AS (
        SELECT "partnerId", "sessionId",
          bool_or("name" = 'page_view') AS "viewed",
          bool_or("name" = 'booking_success') AS "booked"
        FROM scoped
        GROUP BY "partnerId", "sessionId"
      ),
      conv AS (
        SELECT "partnerId",
          (count(*) FILTER (WHERE "viewed"))::int AS "viewSessions",
          (count(*) FILTER (WHERE "viewed" AND "booked"))::int AS "bookedSessions"
        FROM visits
        GROUP BY "partnerId"
      ),
      bk AS (
        SELECT b."partnerId", count(*)::int AS "bookings"
        FROM "bookings" b
        WHERE b."source" = 'public' AND ${bookingsIn(w)}
        GROUP BY b."partnerId"
      )
      SELECT p."id" AS "partnerId", p."name", p."slug",
             COALESCE(ev."views", 0) AS "views",
             COALESCE(ev."visitors", 0) AS "visitors",
             COALESCE(ev."bookClicks", 0) AS "bookClicks",
             COALESCE(ev."bookingOpens", 0) AS "bookingOpens",
             COALESCE(bk."bookings", 0) AS "bookings",
             COALESCE(ev."call", 0) AS "call",
             COALESCE(ev."whatsapp", 0) AS "whatsapp",
             COALESCE(ev."instagram", 0) AS "instagram",
             COALESCE(ev."directions", 0) AS "directions",
             COALESCE(ev."otherContacts", 0) AS "otherContacts",
             COALESCE(conv."viewSessions", 0) AS "viewSessions",
             COALESCE(conv."bookedSessions", 0) AS "bookedSessions"
      FROM "partners" p
      LEFT JOIN ev ON ev."partnerId" = p."id"
      LEFT JOIN conv ON conv."partnerId" = p."id"
      LEFT JOIN bk ON bk."partnerId" = p."id"
      WHERE ev."partnerId" IS NOT NULL OR bk."partnerId" IS NOT NULL
      ORDER BY "views" DESC, "visitors" DESC, p."name"`;
  }

  /**
   * Partner-wide figures that cannot be summed from the rows: one visitor or
   * session on two salons counts once.
   */
  private async partnerTotals(w: Window, includeInternal: boolean): Promise<PartnerTotals> {
    const [row] = await this.prisma.$queryRaw<PartnerTotals[]>`
      WITH scoped AS (
        SELECT e."partnerId", e."sessionId", e."visitorId", e."name"
        FROM "site_events" e
        JOIN "site_sessions" s ON s."id" = e."sessionId"
        WHERE e."partnerId" IS NOT NULL AND ${eventsIn(w)} AND ${audience(includeInternal)}
      ),
      visits AS (
        SELECT "partnerId", "sessionId",
          bool_or("name" = 'page_view') AS "viewed",
          bool_or("name" = 'booking_success') AS "booked"
        FROM scoped
        GROUP BY "partnerId", "sessionId"
      )
      SELECT
        (SELECT count(DISTINCT "visitorId")::int FROM scoped) AS "visitors",
        (SELECT count(DISTINCT "sessionId")::int FROM visits WHERE "viewed") AS "viewSessions",
        (SELECT count(DISTINCT "sessionId")::int FROM visits WHERE "viewed" AND "booked") AS "bookedSessions"`;
    return row;
  }
}

function toRange(w: Window): Range {
  return { from: w.from, to: w.to, days: daysInclusive(w.from, w.to) };
}

function toPartnerRow(r: PartnerAggregate): PartnerRow {
  return {
    partnerId: r.partnerId,
    name: r.name,
    slug: r.slug,
    views: r.views,
    visitors: r.visitors,
    bookClicks: r.bookClicks,
    bookingOpens: r.bookingOpens,
    bookings: r.bookings,
    conversion: conversion(r.bookedSessions, r.viewSessions),
    contacts: {
      call: r.call,
      whatsapp: r.whatsapp,
      instagram: r.instagram,
      directions: r.directions,
      other: r.otherContacts,
    },
  };
}

function toEventRow(r: EventLogRow): AnalyticsEventRow {
  return {
    id: r.id,
    name: r.name,
    createdAt: r.createdAt.toISOString(),
    path: r.path,
    host: r.host,
    props: r.props ?? {},
    partner: r.partnerId
      ? { id: r.partnerId, name: r.partnerName ?? '', slug: r.partnerSlug }
      : null,
    session: {
      id: r.sessionId,
      visitorId: r.visitorId,
      channel: r.channel,
      deviceType: r.deviceType,
      browser: r.browser,
      os: r.os,
      country: r.country,
      city: r.city,
      language: r.language,
      referrerHost: r.referrerHost,
      utmCampaign: r.utmCampaign,
      isInternal: r.isInternal,
    },
  };
}
