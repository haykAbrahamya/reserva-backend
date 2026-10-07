import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { paginate, type Paginated } from '@/common/dto/pagination';
import type { AnalyticsSessionsQuery, SessionOutcome } from './dto/site-analytics-query.dto';
import { audience, eventsIn } from './report-sql';
import type { PartnerRef, SessionDetail, SessionEvent, SessionRow } from './site-analytics.types';

/**
 * Sessions — the console's "person view" (contract §11): visits as lists and
 * as timelines. Anonymous by design: a person is the random visitorId.
 *
 * Every figure about a session (outcome, journey, counts, duration) is taken
 * over ALL its events: an outcome belongs to the visit, not to the date range
 * that happened to find it.
 */

/**
 * The order of a session's events everywhere: the client's clock first (it is
 * what orders the events of one batch, which share a server time), then the
 * server's, then the id so ties are stable.
 */
const CHRONOLOGICAL = Prisma.sql`COALESCE(e."clientAt", e."createdAt"), e."createdAt", e."id"`;

/** The `outcome` filter, as a HAVING over a session's events (alias `e`). */
const OUTCOME: Record<SessionOutcome, Prisma.Sql> = {
  booked: Prisma.sql`bool_or(e."name" = 'booking_success')`,
  contacted: Prisma.sql`bool_or(e."name" = 'contact_click')`,
  signup: Prisma.sql`bool_or(e."name" = 'signup_success')`,
  bookclick: Prisma.sql`bool_or(e."name" IN ('book_click', 'booking_open'))`,
  // Landed and left: one event, and that one a page view.
  bounced: Prisma.sql`count(*) = 1 AND bool_and(e."name" = 'page_view')`,
};

/** Props that point at catalog rows, and where their names live. */
const LABELLED = {
  svc: (ids: string[]) =>
    Prisma.sql`SELECT "id", "name" AS "label" FROM "services" WHERE "id" IN (${Prisma.join(ids)})`,
  sp: (ids: string[]) =>
    Prisma.sql`SELECT "id", "name" AS "label" FROM "specialists" WHERE "id" IN (${Prisma.join(ids)})`,
  loc: (ids: string[]) =>
    Prisma.sql`SELECT "id", "name" AS "label" FROM "locations" WHERE "id" IN (${Prisma.join(ids)})`,
  course: (ids: string[]) =>
    Prisma.sql`SELECT "id", "title" AS "label" FROM "courses" WHERE "id" IN (${Prisma.join(ids)})`,
} as const;
type LabelledProp = keyof typeof LABELLED;

/** A session as the summary query returns it. */
export interface RawSession {
  id: string;
  visitorId: string;
  channel: string;
  utmCampaign: string | null;
  referrerHost: string | null;
  deviceType: string | null;
  browser: string | null;
  os: string | null;
  country: string | null;
  city: string | null;
  language: string | null;
  landingPath: string | null;
  landingHost: string | null;
  isInternal: boolean;
  /** Session columns — the fallback for a session that has no events left. */
  startedAt: Date;
  lastSeenAt: Date;
  firstAt: Date | null;
  lastAt: Date | null;
  eventCount: number | null;
  pageViews: number | null;
  booked: boolean | null;
  contacted: boolean | null;
  signedUp: boolean | null;
  bookClicked: boolean | null;
  journey: string[] | null;
  partners: PartnerRef[] | null;
  visitorSessions: number | null;
}

interface RawEvent {
  id: string;
  name: string;
  createdAt: Date;
  clientAt: Date | null;
  path: string | null;
  host: string | null;
  props: Record<string, unknown> | null;
  partnerId: string | null;
  partnerName: string | null;
  partnerSlug: string | null;
}

@Injectable()
export class SiteSessionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sessions with an event in range, newest first by their first event. */
  async list(q: AnalyticsSessionsQuery): Promise<Paginated<SessionRow>> {
    // Candidates: an event in range (on the partner, when given), from this
    // audience and channel; ranked by first event; filtered by outcome.
    const ranked = Prisma.sql`
      SELECT e."sessionId" AS "id", min(e."createdAt") AS "firstAt"
      FROM "site_events" e
      JOIN "site_sessions" s ON s."id" = e."sessionId"
      WHERE ${audience(q.includeInternal)}
        ${q.channel ? Prisma.sql`AND s."channel" = ${q.channel}` : Prisma.empty}
        AND e."sessionId" IN (
          SELECT e."sessionId" FROM "site_events" e
          WHERE ${eventsIn(q)}
          ${q.partnerId ? Prisma.sql`AND e."partnerId" = ${q.partnerId}` : Prisma.empty}
        )
      GROUP BY e."sessionId"
      ${q.outcome ? Prisma.sql`HAVING ${OUTCOME[q.outcome]}` : Prisma.empty}`;

    const [page, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM (${ranked}) AS ranked
        ORDER BY "firstAt" DESC, "id" DESC
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS "total" FROM (${ranked}) AS ranked`,
    ]);
    return paginate(await this.describe(page.map((r) => r.id)), total, q.page, q.pageSize);
  }

  /** One session in full. Internal sessions included; 404 when unknown. */
  async detail(id: string): Promise<SessionDetail> {
    const [session] = await this.describe([id]);
    if (!session) throw AppException.notFound('Session not found');
    const [events, otherSessions] = await Promise.all([
      this.timeline(id),
      this.otherSessions(id, session.visitorId),
    ]);
    return { session, events, labels: await this.labels(events), otherSessions };
  }

  /** SessionRows for these sessions, in the order given (unknown ids skipped). */
  private async describe(ids: string[]): Promise<SessionRow[]> {
    if (!ids.length) return [];
    const list = Prisma.join(ids);
    const raw = await this.prisma.$queryRaw<RawSession[]>`
      WITH ev AS (
        SELECT e."sessionId", e."name", e."createdAt", e."partnerId",
               row_number() OVER (PARTITION BY e."sessionId" ORDER BY ${CHRONOLOGICAL}) AS "seq"
        FROM "site_events" e
        WHERE e."sessionId" IN (${list})
      ),
      stats AS (
        SELECT "sessionId",
          min("createdAt") AS "firstAt",
          max("createdAt") AS "lastAt",
          count(*)::int AS "eventCount",
          (count(*) FILTER (WHERE "name" = 'page_view'))::int AS "pageViews",
          bool_or("name" = 'booking_success') AS "booked",
          bool_or("name" = 'contact_click') AS "contacted",
          bool_or("name" = 'signup_success') AS "signedUp",
          bool_or("name" IN ('book_click', 'booking_open')) AS "bookClicked",
          array_agg("name" ORDER BY "seq") FILTER (WHERE "seq" <= 12) AS "journey"
        FROM ev
        GROUP BY "sessionId"
      ),
      firsts AS (
        SELECT "sessionId", "partnerId", min("seq") AS "firstSeq"
        FROM ev
        WHERE "partnerId" IS NOT NULL
        GROUP BY "sessionId", "partnerId"
      ),
      touched AS (
        SELECT f."sessionId",
          json_agg(json_build_object('id', p."id", 'name', p."name", 'slug', p."slug") ORDER BY f."firstSeq") AS "partners"
        FROM firsts f
        JOIN "partners" p ON p."id" = f."partnerId"
        GROUP BY f."sessionId"
      ),
      visits AS (
        SELECT o."visitorId", count(*)::int AS "visitorSessions"
        FROM "site_sessions" o
        WHERE NOT o."isBot"
          AND o."visitorId" IN (SELECT "visitorId" FROM "site_sessions" WHERE "id" IN (${list}))
        GROUP BY o."visitorId"
      )
      SELECT s."id", s."visitorId", s."channel", s."utmCampaign", s."referrerHost",
             s."deviceType", s."browser", s."os", s."country", s."city", s."language",
             s."landingPath", s."landingHost", s."isInternal", s."startedAt", s."lastSeenAt",
             st."firstAt", st."lastAt", st."eventCount", st."pageViews",
             st."booked", st."contacted", st."signedUp", st."bookClicked", st."journey",
             t."partners", v."visitorSessions"
      FROM "site_sessions" s
      LEFT JOIN stats st ON st."sessionId" = s."id"
      LEFT JOIN touched t ON t."sessionId" = s."id"
      LEFT JOIN visits v ON v."visitorId" = s."visitorId"
      WHERE s."id" IN (${list})`;
    const byId = new Map(raw.map((r) => [r.id, toSessionRow(r)]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  /** Every event of the session, in order. */
  private async timeline(id: string): Promise<SessionEvent[]> {
    const rows = await this.prisma.$queryRaw<RawEvent[]>`
      SELECT e."id", e."name", e."createdAt", e."clientAt", e."path", e."host", e."props",
             p."id" AS "partnerId", p."name" AS "partnerName", p."slug" AS "partnerSlug"
      FROM "site_events" e
      LEFT JOIN "partners" p ON p."id" = e."partnerId"
      WHERE e."sessionId" = ${id}
      ORDER BY ${CHRONOLOGICAL}`;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      at: r.createdAt.toISOString(),
      clientAt: r.clientAt ? r.clientAt.toISOString() : null,
      path: r.path,
      host: r.host,
      partner: r.partnerId
        ? { id: r.partnerId, name: r.partnerName ?? '', slug: r.partnerSlug }
        : null,
      props: r.props ?? {},
    }));
  }

  /** Names for the catalog ids the events point at, each looked up in its own table. */
  private async labels(events: SessionEvent[]): Promise<Record<string, string>> {
    const wanted = labelIds(events);
    const parts = (Object.keys(LABELLED) as LabelledProp[])
      .filter((prop) => wanted[prop].length)
      .map((prop) => LABELLED[prop](wanted[prop]));
    if (!parts.length) return {};
    const rows = await this.prisma.$queryRaw<{ id: string; label: string }[]>`
      ${Prisma.join(parts, ' UNION ALL ')}`;
    return Object.fromEntries(rows.map((r) => [r.id, r.label]));
  }

  /** The same visitor's other sessions (bots aside), newest first. */
  private async otherSessions(
    id: string,
    visitorId: string,
  ): Promise<SessionDetail['otherSessions']> {
    const rows = await this.prisma.$queryRaw<
      { id: string; channel: string; startedAt: Date; eventCount: number; booked: boolean }[]
    >`
      SELECT s."id", s."channel",
             COALESCE(min(e."createdAt"), s."startedAt") AS "startedAt",
             count(e."id")::int AS "eventCount",
             COALESCE(bool_or(e."name" = 'booking_success'), false) AS "booked"
      FROM "site_sessions" s
      LEFT JOIN "site_events" e ON e."sessionId" = s."id"
      WHERE s."visitorId" = ${visitorId} AND s."id" <> ${id} AND NOT s."isBot"
      GROUP BY s."id"
      ORDER BY 3 DESC, s."id" DESC
      LIMIT 20`;
    return rows.map((r) => ({ ...r, startedAt: r.startedAt.toISOString() }));
  }
}

/** A summary row as the API returns it. */
export function toSessionRow(r: RawSession): SessionRow {
  const first = r.firstAt ?? r.startedAt;
  const last = r.lastAt ?? r.lastSeenAt;
  return {
    id: r.id,
    visitorId: r.visitorId,
    startedAt: first.toISOString(),
    lastSeenAt: last.toISOString(),
    durationSec: Math.max(0, Math.round((last.getTime() - first.getTime()) / 1000)),
    channel: r.channel,
    utmCampaign: r.utmCampaign,
    referrerHost: r.referrerHost,
    deviceType: r.deviceType,
    browser: r.browser,
    os: r.os,
    country: r.country,
    city: r.city,
    language: r.language,
    landingPath: r.landingPath,
    landingHost: r.landingHost,
    isInternal: r.isInternal,
    eventCount: r.eventCount ?? 0,
    pageViews: r.pageViews ?? 0,
    partners: (r.partners ?? []).slice(0, 5),
    outcome: {
      booked: r.booked === true,
      contacted: r.contacted === true,
      signedUp: r.signedUp === true,
      bookClicked: r.bookClicked === true,
    },
    journey: (r.journey ?? []).slice(0, 12),
    visitorSessions: r.visitorSessions ?? 0,
  };
}

/** The catalog ids in events' props, per prop, each once. Anything but a non-empty string is ignored. */
export function labelIds(
  events: { props: Record<string, unknown> }[],
): Record<LabelledProp, string[]> {
  const out = {
    svc: new Set<string>(),
    sp: new Set<string>(),
    loc: new Set<string>(),
    course: new Set<string>(),
  };
  for (const { props } of events) {
    for (const prop of Object.keys(out) as LabelledProp[]) {
      const value = props?.[prop];
      if (typeof value === 'string' && value) out[prop].add(value);
    }
  }
  return { svc: [...out.svc], sp: [...out.sp], loc: [...out.loc], course: [...out.course] };
}
