import { Prisma } from '@prisma/client';
import type { PrismaService } from '@/prisma/prisma.service';
import { IN_APP_BROWSERS, SiteToolsService, TOOLS_UTM_SOURCE, exportRate } from './site-tools.service';

/**
 * The tools report (tools.reserva.am). The SQL runs against Postgres in the
 * end-to-end check; here it is captured, not executed — these pin the export
 * rate, which site each block counts, the previous period, and how the rows
 * are shaped for the console.
 */
describe('exportRate', () => {
  it('is exporting sessions over opening sessions, to 4 decimals', () => {
    expect(exportRate(3, 40)).toBe(0.075);
    expect(exportRate(1, 3)).toBe(0.3333);
    expect(exportRate(0, 25)).toBe(0);
  });

  it('is null when nobody opened the tool, and never passes 1', () => {
    expect(exportRate(0, 0)).toBeNull();
    expect(exportRate(5, 0)).toBeNull();
    expect(exportRate(9, 4)).toBe(1);
  });
});

/** A service over a $queryRaw double that answers each block by what its SQL is for. */
function setup() {
  const queries: Prisma.Sql[] = [];
  const $queryRaw = jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = Prisma.sql(strings, ...values);
    queries.push(sql);
    const text = sql.sql;
    // This period ends before Yerevan midnight of 10-08; the one before, of 10-01.
    const current = sql.values.includes('2026-10-08');
    if (text.includes('LEFT JOIN conv')) {
      return [
        {
          tool: 'priceList',
          views: 40,
          visitors: 31,
          edits: 25,
          exports: 18,
          share: 11,
          download: 7,
          pdf: 0,
          whatsapp: 0,
          viber: 0,
          copy: 0,
          hold: 2,
          ctaClicks: 4,
          errors: 1,
          viewSessions: 30,
          exportSessions: 15,
        },
      ];
    }
    if (text.includes(`'browser_open'`)) {
      return [current ? { sessions: 12, opened: 4 } : { sessions: 5, opened: 1 }];
    }
    if (text.includes('AS "handle"')) {
      return [
        {
          handle: 'anna.beauty',
          exports: 3,
          tools: ['freeSlots', 'priceList'],
          lastAt: new Date('2026-10-05T10:00:00Z'),
          sessionId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        },
      ];
    }
    if (text.includes('AS "toolViews"') && text.includes('GROUP BY 1')) {
      return [{ date: '2026-10-02', visitors: 9, sessions: 10, toolViews: 12, exports: 5 }];
    }
    if (text.includes('AS "cardViews"')) {
      return [current
        ? { visitors: 50, sessions: 61, toolViews: 70, edits: 33, exports: 24, cardViews: 8, ctaClicks: 6 }
        : { visitors: 20, sessions: 22, toolViews: 25, edits: 10, exports: 9, cardViews: 2, ctaClicks: 1 }];
    }
    if (text.includes('AS "spot"')) return [{ spot: 'price-list', visits: 4, signups: 1 }];
    if (text.includes('AS sent')) return [current ? { visits: 5, signupStarts: 3, signups: 1 } : { visits: 1, signupStarts: 0, signups: 0 }];
    if (text.includes('AS "topValue"')) return [{ tool: 'priceList', act: 'theme', count: 9, topValue: 'mocha', topCount: 6 }];
    if (text.includes(`'lng'`)) return [{ language: 'hy', views: 60 }];
    if (text.includes(`'tool_error'`)) return [{ tool: 'priceList', code: 'share', count: 1 }];
    if (text.includes('AS "key"')) {
      if (sql.values.includes('via')) return [{ key: 'share', count: 11 }, { key: 'download', count: 7 }];
      if (sql.values.includes('theme')) return [{ key: 'mocha', count: 10 }];
      if (sql.values.includes('act')) return [{ key: 'calendar', count: 3 }];
    }
    throw new Error(`unexpected query: ${text}`);
  });
  const service = new SiteToolsService({ $queryRaw } as unknown as PrismaService);
  return { service, queries };
}

const q = { from: '2026-10-01', to: '2026-10-07', includeInternal: false, site: 'web' as const };

describe('SiteToolsService.report', () => {
  it('counts the tools on their own site, whatever site the toolbar was on', async () => {
    const { service, queries } = setup();
    await service.report(q);
    const tools = queries.filter((x) => !x.sql.includes('utmSource'));
    expect(tools.length).toBeGreaterThan(8);
    for (const x of tools) {
      expect(x.sql).toContain('s."site" = ?');
      expect(x.values).toContain('tools');
      expect(x.values).not.toContain('web');
    }
  });

  it('follows the visitors it sent into reserva.am: booking-site sessions tagged by the tools', async () => {
    const { service, queries } = setup();
    await service.report(q);
    const sent = queries.filter((x) => x.sql.includes('utmSource'));
    expect(sent).toHaveLength(3); // this period, the one before, and by spot
    for (const x of sent) {
      expect(x.sql).toContain('s."utmSource" = ?');
      expect(x.values).toEqual(expect.arrayContaining(['web', TOOLS_UTM_SOURCE]));
      expect(x.values).not.toContain('tools');
    }
  });

  it('compares with the equally long period right before', async () => {
    const { service, queries } = setup();
    const report = await service.report(q);
    const before = queries.find((x) => x.sql.includes('AS "cardViews"') && x.values.includes('2026-09-24'));
    expect(before?.values).toEqual(expect.arrayContaining(['2026-09-24', '2026-10-01']));
    expect(report.kpis.exports).toEqual({ value: 24, prev: 9 });
    expect(report.kpis.cardViews).toEqual({ value: 8, prev: 2 });
    expect(report.toPlatform.signups).toEqual({ value: 1, prev: 0 });
  });

  it('shapes rows, breakdowns and a zero-filled daily series for the console', async () => {
    const { service } = setup();
    const report = await service.report(q);
    expect(report.range).toEqual({ from: '2026-10-01', to: '2026-10-07', days: 7 });
    expect(report.tools).toEqual([
      {
        tool: 'priceList',
        views: 40,
        visitors: 31,
        edits: 25,
        exports: 18,
        exportRate: 0.5,
        exportsBy: { share: 11, download: 7, pdf: 0, whatsapp: 0, viber: 0, copy: 0, hold: 2 },
        ctaClicks: 4,
        errors: 1,
      },
    ]);
    expect(report.series).toHaveLength(7);
    expect(report.series[1]).toEqual({ date: '2026-10-02', visitors: 9, sessions: 10, toolViews: 12, exports: 5 });
    expect(report.series[0]).toEqual({ date: '2026-10-01', visitors: 0, sessions: 0, toolViews: 0, exports: 0 });
    expect(report.exportsBy).toEqual([{ via: 'share', count: 11 }, { via: 'download', count: 7 }]);
    expect(report.themes).toEqual([{ theme: 'mocha', count: 10 }]);
    expect(report.visit).toEqual([{ act: 'calendar', count: 3 }]);
    expect(report.actions[0]).toMatchObject({ act: 'theme', topValue: 'mocha' });
    expect(report.toPlatform.bySpot).toEqual([{ spot: 'price-list', visits: 4, signups: 1 }]);
  });

  it('counts visits inside apps by their built-in browsers, against the period before', async () => {
    const { service, queries } = setup();
    const report = await service.report(q);
    const inApp = queries.filter((x) => x.sql.includes(`'browser_open'`));
    expect(inApp).toHaveLength(2);
    for (const x of inApp) {
      expect(x.sql).toContain('s."browser" IN (');
      expect(x.values).toEqual(expect.arrayContaining(IN_APP_BROWSERS));
    }
    expect(report.inApp).toEqual({ sessions: { value: 12, prev: 5 }, opened: { value: 4, prev: 1 } });
  });

  it('lists the Instagram accounts results were signed with, latest first, with the visit to open', async () => {
    const { service, queries } = setup();
    const report = await service.report(q);
    const sql = queries.find((x) => x.sql.includes('AS "handle"'));
    expect(sql?.sql).toContain(`e."props"->>'ig' IS NOT NULL`);
    expect(sql?.sql).toContain('ORDER BY max(e."createdAt") DESC');
    expect(report.accounts).toEqual([
      {
        handle: 'anna.beauty',
        exports: 3,
        tools: ['freeSlots', 'priceList'],
        lastAt: '2026-10-05T10:00:00.000Z',
        sessionId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      },
    ]);
  });

  it('never splices a prop name into the SQL text', async () => {
    const { service, queries } = setup();
    await service.report(q);
    for (const x of queries.filter((y) => y.sql.includes('AS "key"'))) {
      expect(x.sql).toContain(`e."props"->>(?::text)`);
      expect(x.sql).not.toMatch(/'(via|theme|act)'/);
    }
  });
});
