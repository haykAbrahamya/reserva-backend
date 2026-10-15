import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { addDays, daysInclusive, eachDay } from './calendar-day';
import { audience, eventsIn, type Audience, type Window } from './report-sql';
import type { AnalyticsRangeQuery } from './dto/site-analytics-query.dto';
import type { AnalyticsTools, Kpi, ToolRow } from './site-analytics.types';

/** The utm_source every link from the tools into reserva.am carries (apps/tools lib/links.ts). */
export const TOOLS_UTM_SOURCE = 'reserva-tools';

/**
 * The names ua-parser-js gives the browsers built into apps — where a link in
 * a reel or an ad opens. "Chrome WebView" is any other Android app's.
 */
export const IN_APP_BROWSERS = ['Instagram', 'Facebook', 'TikTok', 'Snapchat', 'Chrome WebView'];

/**
 * Export rate: of the sessions that opened a tool, the share that also took a
 * result away. Sessions on both sides, like partner conversion, so it cannot
 * pass 1; the clamp keeps that promise whatever it is fed.
 */
export function exportRate(exportSessions: number, viewSessions: number): number | null {
  if (!(viewSessions > 0)) return null;
  return Math.round((Math.min(exportSessions, viewSessions) / viewSessions) * 10_000) / 10_000;
}

interface ToolKpis {
  visitors: number;
  sessions: number;
  toolViews: number;
  edits: number;
  exports: number;
  cardViews: number;
  ctaClicks: number;
}

interface PlatformKpis {
  visits: number;
  signupStarts: number;
  signups: number;
}

interface InAppKpis {
  sessions: number;
  opened: number;
}

interface ToolAggregate {
  tool: string;
  views: number;
  visitors: number;
  edits: number;
  exports: number;
  share: number;
  download: number;
  pdf: number;
  whatsapp: number;
  viber: number;
  copy: number;
  hold: number;
  ctaClicks: number;
  errors: number;
  viewSessions: number;
  exportSessions: number;
}

/**
 * The console's report on tools.reserva.am (/platform/analytics/tools): what
 * was opened, edited, made and sent, how it left, and how many of the tools'
 * visitors went on to reserva.am and signed up. Every figure but the last
 * block counts tools sessions only; that block counts the booking site's
 * sessions that the tools sent there.
 */
@Injectable()
export class SiteToolsService {
  constructor(private readonly prisma: PrismaService) {}

  async report(q: AnalyticsRangeQuery): Promise<AnalyticsTools> {
    const tools: Audience = { includeInternal: q.includeInternal, site: 'tools' };
    const web: Audience = { includeInternal: q.includeInternal, site: 'web' };
    const days = daysInclusive(q.from, q.to);
    // The equally long period that ends the day before `from`.
    const prev: Window = { from: addDays(q.from, -days), to: addDays(q.from, -1) };

    const [
      now,
      before,
      daily,
      rows,
      exportsBy,
      themes,
      actions,
      visit,
      languages,
      errors,
      inApp,
      inAppBefore,
      accounts,
      platform,
      platformBefore,
      bySpot,
    ] = await Promise.all([
      this.kpis(q, tools),
      this.kpis(prev, tools),
      this.daily(q, tools),
      this.toolAggregates(q, tools),
      this.countBy(q, tools, 'tool_export', 'via'),
      this.countBy(q, tools, 'tool_export', 'theme'),
      this.actions(q, tools),
      this.countBy(q, tools, 'visit_action', 'act'),
      this.languages(q, tools),
      this.errors(q, tools),
      this.inAppKpis(q, tools),
      this.inAppKpis(prev, tools),
      this.accounts(q, tools),
      this.platformKpis(q, web),
      this.platformKpis(prev, web),
      this.platformBySpot(q, web),
    ]);

    const kpi = (value: number, prevValue: number): Kpi => ({ value, prev: prevValue });
    const byDay = new Map(daily.map((d) => [d.date, d]));

    return {
      range: { from: q.from, to: q.to, days },
      kpis: {
        visitors: kpi(now.visitors, before.visitors),
        sessions: kpi(now.sessions, before.sessions),
        toolViews: kpi(now.toolViews, before.toolViews),
        edits: kpi(now.edits, before.edits),
        exports: kpi(now.exports, before.exports),
        cardViews: kpi(now.cardViews, before.cardViews),
        ctaClicks: kpi(now.ctaClicks, before.ctaClicks),
      },
      series: eachDay(q.from, q.to).map((date) => ({
        date,
        visitors: byDay.get(date)?.visitors ?? 0,
        sessions: byDay.get(date)?.sessions ?? 0,
        toolViews: byDay.get(date)?.toolViews ?? 0,
        exports: byDay.get(date)?.exports ?? 0,
      })),
      tools: rows.map(toToolRow),
      exportsBy: exportsBy.map((r) => ({ via: r.key, count: r.count })),
      themes: themes.map((r) => ({ theme: r.key, count: r.count })),
      actions,
      visit: visit.map((r) => ({ act: r.key, count: r.count })),
      languages,
      errors,
      inApp: {
        sessions: kpi(inApp.sessions, inAppBefore.sessions),
        opened: kpi(inApp.opened, inAppBefore.opened),
      },
      accounts: accounts.map((a) => ({ ...a, lastAt: a.lastAt.toISOString() })),
      toPlatform: {
        visits: kpi(platform.visits, platformBefore.visits),
        signupStarts: kpi(platform.signupStarts, platformBefore.signupStarts),
        signups: kpi(platform.signups, platformBefore.signups),
        bySpot,
      },
    };
  }

  // ── Building blocks ──────────────────────────────────────────

  private async kpis(w: Window, a: Audience): Promise<ToolKpis> {
    const [row] = await this.prisma.$queryRaw<ToolKpis[]>`
      SELECT
        count(DISTINCT e."visitorId")::int AS "visitors",
        count(DISTINCT e."sessionId")::int AS "sessions",
        (count(*) FILTER (WHERE e."name" = 'page_view' AND e."props"->>'pt' = 'tool'))::int AS "toolViews",
        (count(*) FILTER (WHERE e."name" = 'tool_edit'))::int AS "edits",
        (count(*) FILTER (WHERE e."name" = 'tool_export'))::int AS "exports",
        (count(*) FILTER (WHERE e."name" = 'page_view' AND e."props"->>'pt' = 'visit'))::int AS "cardViews",
        (count(*) FILTER (WHERE e."name" = 'cta_click'))::int AS "ctaClicks"
      FROM "site_events" e
      JOIN "site_sessions" s ON s."id" = e."sessionId"
      WHERE ${eventsIn(w)} AND ${audience(a)}`;
    return row;
  }

  private daily(w: Window, a: Audience) {
    return this.prisma.$queryRaw<AnalyticsTools['series']>`
      SELECT to_char((e."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Yerevan')::date, 'YYYY-MM-DD') AS "date",
             count(DISTINCT e."visitorId")::int AS "visitors",
             count(DISTINCT e."sessionId")::int AS "sessions",
             (count(*) FILTER (WHERE e."name" = 'page_view' AND e."props"->>'pt' = 'tool'))::int AS "toolViews",
             (count(*) FILTER (WHERE e."name" = 'tool_export'))::int AS "exports"
      FROM "site_events" e
      JOIN "site_sessions" s ON s."id" = e."sessionId"
      WHERE ${eventsIn(w)} AND ${audience(a)}
      GROUP BY 1`;
  }

  /**
   * One row per tool with any event in range. A tool's events are the ones
   * whose props name it — its page views, edits, actions, exports, errors and
   * the clicks into reserva.am made on its page.
   */
  private toolAggregates(w: Window, a: Audience) {
    return this.prisma.$queryRaw<ToolAggregate[]>`
      WITH scoped AS (
        SELECT e."sessionId", e."visitorId", e."name", e."props", e."props"->>'tool' AS "tool"
        FROM "site_events" e
        JOIN "site_sessions" s ON s."id" = e."sessionId"
        WHERE ${eventsIn(w)} AND ${audience(a)} AND e."props"->>'tool' IS NOT NULL
      ),
      ev AS (
        SELECT "tool",
          (count(*) FILTER (WHERE "name" = 'page_view'))::int AS "views",
          count(DISTINCT "visitorId")::int AS "visitors",
          (count(*) FILTER (WHERE "name" = 'tool_edit'))::int AS "edits",
          (count(*) FILTER (WHERE "name" = 'tool_export'))::int AS "exports",
          (count(*) FILTER (WHERE "name" = 'tool_export' AND "props"->>'via' = 'share'))::int AS "share",
          (count(*) FILTER (WHERE "name" = 'tool_export' AND "props"->>'via' = 'download'))::int AS "download",
          (count(*) FILTER (WHERE "name" = 'tool_export' AND "props"->>'via' = 'pdf'))::int AS "pdf",
          (count(*) FILTER (WHERE "name" = 'tool_export' AND "props"->>'via' = 'whatsapp'))::int AS "whatsapp",
          (count(*) FILTER (WHERE "name" = 'tool_export' AND "props"->>'via' = 'viber'))::int AS "viber",
          (count(*) FILTER (WHERE "name" = 'tool_export' AND "props"->>'via' = 'copy'))::int AS "copy",
          (count(*) FILTER (WHERE "name" = 'tool_export' AND "props"->>'via' = 'hold'))::int AS "hold",
          (count(*) FILTER (WHERE "name" = 'cta_click'))::int AS "ctaClicks",
          (count(*) FILTER (WHERE "name" = 'tool_error'))::int AS "errors"
        FROM scoped
        GROUP BY "tool"
      ),
      visits AS (
        SELECT "tool", "sessionId",
          bool_or("name" = 'page_view') AS "viewed",
          bool_or("name" = 'tool_export') AS "exported"
        FROM scoped
        GROUP BY "tool", "sessionId"
      ),
      conv AS (
        SELECT "tool",
          (count(*) FILTER (WHERE "viewed"))::int AS "viewSessions",
          (count(*) FILTER (WHERE "viewed" AND "exported"))::int AS "exportSessions"
        FROM visits
        GROUP BY "tool"
      )
      SELECT ev.*,
             COALESCE(conv."viewSessions", 0) AS "viewSessions",
             COALESCE(conv."exportSessions", 0) AS "exportSessions"
      FROM ev
      LEFT JOIN conv ON conv."tool" = ev."tool"
      ORDER BY "views" DESC, "exports" DESC, ev."tool"`;
  }

  /**
   * One event's count by one of its props, most first. The prop name travels
   * as a parameter like any value; the cast picks jsonb's text-key `->>` over
   * its array-index twin.
   */
  private countBy(w: Window, a: Audience, name: string, prop: 'via' | 'theme' | 'act') {
    return this.prisma.$queryRaw<{ key: string; count: number }[]>`
      SELECT e."props"->>(${prop}::text) AS "key", count(*)::int AS "count"
      FROM "site_events" e
      JOIN "site_sessions" s ON s."id" = e."sessionId"
      WHERE e."name" = ${name} AND ${eventsIn(w)} AND ${audience(a)} AND e."props"->>(${prop}::text) IS NOT NULL
      GROUP BY 1
      ORDER BY "count" DESC, 1`;
  }

  /** tool_action per tool and action, each with the value chosen most (a theme, a side, a format). */
  private actions(w: Window, a: Audience) {
    return this.prisma.$queryRaw<AnalyticsTools['actions']>`
      WITH acts AS (
        SELECT e."props"->>'tool' AS "tool", e."props"->>'act' AS "act", e."props"->>'v' AS "v"
        FROM "site_events" e
        JOIN "site_sessions" s ON s."id" = e."sessionId"
        WHERE e."name" = 'tool_action' AND ${eventsIn(w)} AND ${audience(a)}
      ),
      totals AS (
        SELECT "tool", "act", count(*)::int AS "count" FROM acts GROUP BY "tool", "act"
      ),
      vals AS (
        SELECT "tool", "act", "v", count(*)::int AS "n",
               row_number() OVER (PARTITION BY "tool", "act" ORDER BY count(*) DESC, "v") AS "rank"
        FROM acts
        WHERE "v" IS NOT NULL
        GROUP BY "tool", "act", "v"
      )
      SELECT t."tool", t."act", t."count", v."v" AS "topValue", COALESCE(v."n", 0) AS "topCount"
      FROM totals t
      LEFT JOIN vals v ON v."tool" = t."tool" AND v."act" = t."act" AND v."rank" = 1
      ORDER BY t."count" DESC, t."tool", t."act"
      LIMIT 40`;
  }

  private languages(w: Window, a: Audience) {
    return this.prisma.$queryRaw<AnalyticsTools['languages']>`
      SELECT e."props"->>'lng' AS "language", count(*)::int AS "views"
      FROM "site_events" e
      JOIN "site_sessions" s ON s."id" = e."sessionId"
      WHERE e."name" = 'page_view' AND ${eventsIn(w)} AND ${audience(a)} AND e."props"->>'lng' IS NOT NULL
      GROUP BY 1
      ORDER BY "views" DESC, 1`;
  }

  /**
   * Sessions in an app's built-in browser, and what happened in them. A visit
   * taken to Chrome keeps its session (apps/tools lib/handoff), so it counts
   * once, under the browser it started in.
   */
  private async inAppKpis(w: Window, a: Audience): Promise<InAppKpis> {
    const [row] = await this.prisma.$queryRaw<InAppKpis[]>`
      SELECT
        (count(DISTINCT e."sessionId") FILTER (WHERE s."browser" IN (${Prisma.join(IN_APP_BROWSERS)})))::int AS "sessions",
        (count(DISTINCT e."sessionId") FILTER (WHERE e."name" = 'browser_open'))::int AS "opened"
      FROM "site_events" e
      JOIN "site_sessions" s ON s."id" = e."sessionId"
      WHERE ${eventsIn(w)} AND ${audience(a)}`;
    return row;
  }

  /**
   * The Instagram accounts results were signed with, latest first: how many
   * exports each made, from which tools, and the visit of its latest one.
   */
  private accounts(w: Window, a: Audience) {
    return this.prisma.$queryRaw<
      { handle: string; exports: number; tools: string[]; lastAt: Date; sessionId: string }[]
    >`
      SELECT e."props"->>'ig' AS "handle",
             count(*)::int AS "exports",
             array_agg(DISTINCT e."props"->>'tool') AS "tools",
             max(e."createdAt") AS "lastAt",
             (array_agg(e."sessionId"::text ORDER BY e."createdAt" DESC))[1] AS "sessionId"
      FROM "site_events" e
      JOIN "site_sessions" s ON s."id" = e."sessionId"
      WHERE e."name" = 'tool_export' AND ${eventsIn(w)} AND ${audience(a)} AND e."props"->>'ig' IS NOT NULL
      GROUP BY 1
      ORDER BY max(e."createdAt") DESC
      LIMIT 100`;
  }

  private errors(w: Window, a: Audience) {
    return this.prisma.$queryRaw<AnalyticsTools['errors']>`
      SELECT e."props"->>'tool' AS "tool", e."props"->>'code' AS "code", count(*)::int AS "count"
      FROM "site_events" e
      JOIN "site_sessions" s ON s."id" = e."sessionId"
      WHERE e."name" = 'tool_error' AND ${eventsIn(w)} AND ${audience(a)}
      GROUP BY 1, 2
      ORDER BY "count" DESC, 1, 2
      LIMIT 20`;
  }

  /**
   * Booking-site sessions the tools sent (utm_source=reserva-tools) with an
   * event in the window, and of them the ones that started / finished the
   * sign-up. Like a session's outcome, the sign-up counts over the visit.
   */
  private platformSessions(w: Window, a: Audience) {
    return Prisma.sql`
      SELECT s."id", s."utmContent",
             bool_or(e."name" = 'signup_start') AS "started",
             bool_or(e."name" = 'signup_success') AS "signedUp"
      FROM "site_sessions" s
      JOIN "site_events" e ON e."sessionId" = s."id"
      WHERE ${audience(a)} AND s."utmSource" = ${TOOLS_UTM_SOURCE}
        AND s."id" IN (SELECT e."sessionId" FROM "site_events" e WHERE ${eventsIn(w)})
      GROUP BY s."id", s."utmContent"`;
  }

  private async platformKpis(w: Window, a: Audience): Promise<PlatformKpis> {
    const [row] = await this.prisma.$queryRaw<PlatformKpis[]>`
      SELECT count(*)::int AS "visits",
             (count(*) FILTER (WHERE "started"))::int AS "signupStarts",
             (count(*) FILTER (WHERE "signedUp"))::int AS "signups"
      FROM (${this.platformSessions(w, a)}) AS sent`;
    return row;
  }

  private platformBySpot(w: Window, a: Audience) {
    return this.prisma.$queryRaw<AnalyticsTools['toPlatform']['bySpot']>`
      SELECT COALESCE(NULLIF("utmContent", ''), 'other') AS "spot",
             count(*)::int AS "visits",
             (count(*) FILTER (WHERE "signedUp"))::int AS "signups"
      FROM (${this.platformSessions(w, a)}) AS sent
      GROUP BY 1
      ORDER BY "visits" DESC, 1`;
  }
}

function toToolRow(r: ToolAggregate): ToolRow {
  return {
    tool: r.tool,
    views: r.views,
    visitors: r.visitors,
    edits: r.edits,
    exports: r.exports,
    exportRate: exportRate(r.exportSessions, r.viewSessions),
    exportsBy: {
      share: r.share,
      download: r.download,
      pdf: r.pdf,
      whatsapp: r.whatsapp,
      viber: r.viber,
      copy: r.copy,
      hold: r.hold,
    },
    ctaClicks: r.ctaClicks,
    errors: r.errors,
  };
}
