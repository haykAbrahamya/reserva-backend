import { Prisma } from '@prisma/client';
import type { PrismaService } from '@/prisma/prisma.service';
import { SiteAnalyticsService, conversion } from './site-analytics.service';

/**
 * Conversion is the one partner figure that is a ratio, and the console shows
 * it as a percentage. It once divided DB bookings by tracked visitors — two
 * different populations — and showed salons converting at 500%. Contract §9:
 * it is booked sessions over viewing sessions, so it can never pass 100%.
 */
describe('conversion', () => {
  it('is booked sessions over viewing sessions, to 4 decimals', () => {
    expect(conversion(3, 40)).toBe(0.075);
    expect(conversion(1, 3)).toBe(0.3333);
    expect(conversion(0, 25)).toBe(0);
    expect(conversion(25, 25)).toBe(1);
  });

  it('is null when no session viewed the page', () => {
    expect(conversion(0, 0)).toBeNull();
    expect(conversion(5, 0)).toBeNull();
  });

  it('never exceeds 1, whatever it is fed', () => {
    for (let i = 0; i < 1000; i++) {
      const viewed = Math.floor(Math.random() * 50);
      const booked = Math.floor(Math.random() * 100);
      const c = conversion(booked, viewed);
      if (c !== null) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('SiteAnalyticsService.partners — conversion from one population', () => {
  const row = (over: Record<string, unknown>) => ({
    partnerId: 'p1',
    name: 'Antheris',
    slug: 'antheris',
    views: 58,
    visitors: 52,
    bookClicks: 9,
    bookingOpens: 8,
    // DB truth: far more bookings than the tracker ever saw visitors (seeded
    // data, old cached clients, blockers) — exactly what broke the old ratio.
    bookings: 295,
    call: 1,
    whatsapp: 2,
    instagram: 0,
    directions: 1,
    otherContacts: 0,
    viewSessions: 40,
    bookedSessions: 3,
    ...over,
  });

  function serviceReturning(rows: ReturnType<typeof row>[], totals: Record<string, number>) {
    // Tell the two queries apart by their SQL; neither hits a database here.
    const $queryRaw = jest.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      return sql.includes('LEFT JOIN conv') ? rows : [totals];
    });
    return new SiteAnalyticsService({ $queryRaw } as unknown as PrismaService);
  }

  it('divides booked sessions by viewing sessions, never DB bookings by visitors', async () => {
    const service = serviceReturning(
      [
        row({}),
        // A partner known only from DB bookings: nobody tracked viewing it.
        row({
          partnerId: 'p2',
          name: 'Mane',
          slug: 'mane',
          views: 0,
          visitors: 0,
          bookings: 12,
          viewSessions: 0,
          bookedSessions: 0,
        }),
        row({
          partnerId: 'p3',
          name: 'Gohar',
          slug: 'gohar',
          bookings: 80,
          viewSessions: 9,
          bookedSessions: 9,
        }),
      ],
      { visitors: 60, viewSessions: 49, bookedSessions: 12 },
    );
    const report = await service.partners({
      from: '2026-09-01',
      to: '2026-10-07',
      includeInternal: false,
    });

    expect(report.rows.map((r) => r.conversion)).toEqual([0.075, null, 1]);
    expect(report.rows.map((r) => r.bookings)).toEqual([295, 12, 80]); // still the DB truth
    expect(report.totals.conversion).toBe(0.2449);
    expect(report.totals.bookings).toBe(387);
    for (const c of [...report.rows.map((r) => r.conversion), report.totals.conversion]) {
      if (c !== null) expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('reports no conversion when no partner page was viewed', async () => {
    const service = serviceReturning([], { visitors: 0, viewSessions: 0, bookedSessions: 0 });
    const report = await service.partners({
      from: '2026-09-01',
      to: '2026-09-01',
      includeInternal: true,
    });
    expect(report.rows).toEqual([]);
    expect(report.totals).toMatchObject({ visitors: 0, bookings: 0, conversion: null });
  });
});

/**
 * Clearing data is the console's one destructive action. These pin what it
 * may touch (the two analytics tables, nothing else), that it is a single
 * transaction, and where `before` draws the line. The SQL itself runs against
 * Postgres in the end-to-end check; here it is captured, not executed.
 */
describe('SiteAnalyticsService.clear / storage', () => {
  function setup() {
    const statements: Prisma.Sql[] = [];
    const db = {
      $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        statements.push(Prisma.sql(strings, ...(values as Prisma.Sql[])));
        return statements.length === 1 ? 120 : 7;
      }),
      $queryRaw: jest.fn(),
      siteEvent: { deleteMany: jest.fn(async () => ({ count: 5000 })) },
      siteSession: { deleteMany: jest.fn(async () => ({ count: 900 })) },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const service = new SiteAnalyticsService(db as unknown as PrismaService);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    return { db, service, statements };
  }

  it('with `before`: events before that Yerevan midnight, then sessions left empty — in one transaction', async () => {
    const { db, service, statements } = setup();
    await expect(service.clear('2026-09-01', 'owner-1')).resolves.toEqual({
      events: 120,
      sessions: 7,
    });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const [events, sessions] = statements;
    const cutoff = `::date)::timestamp AT TIME ZONE 'Asia/Yerevan') AT TIME ZONE 'UTC'`;
    expect(events.sql.trim()).toMatch(/^DELETE FROM "site_events" WHERE "createdAt" < /);
    expect(events.sql).toContain(cutoff);
    expect(events.values).toEqual(['2026-09-01']);
    expect(sessions.sql.trim()).toMatch(/^DELETE FROM "site_sessions" s/);
    expect(sessions.sql).toMatch(
      /NOT EXISTS \(SELECT 1 FROM "site_events" e WHERE e."sessionId" = s."id"\)/,
    );
    expect(db.siteEvent.deleteMany).not.toHaveBeenCalled();
  });

  it('with `before`: only empty sessions last seen before the same cutoff, never newer ones', async () => {
    const { service, statements } = setup();
    await service.clear('2026-09-01', 'owner-1');
    const sessions = statements[1];
    expect(sessions.sql).toMatch(
      /s\."lastSeenAt" < \(\(\(\?::date\)::timestamp AT TIME ZONE 'Asia\/Yerevan'\) AT TIME ZONE 'UTC'\)/,
    );
    expect(sessions.values).toEqual(['2026-09-01']);
  });

  it('without `before`: every event and session, in one transaction', async () => {
    const { db, service, statements } = setup();
    await expect(service.clear(undefined, 'owner-1')).resolves.toEqual({
      events: 5000,
      sessions: 900,
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.siteEvent.deleteMany).toHaveBeenCalledWith({});
    expect(db.siteSession.deleteMany).toHaveBeenCalledWith({});
    expect(statements).toHaveLength(0);
  });

  it('never names another table', async () => {
    const { service, statements } = setup();
    await service.clear('2026-09-01', 'owner-1');
    expect(statements).toHaveLength(2);
    for (const s of statements) {
      const tables = [...s.sql.matchAll(/(?:FROM|JOIN|UPDATE|INTO)\s+"(\w+)"/g)].map((m) => m[1]);
      expect(tables.length).toBeGreaterThan(0);
      expect(tables.every((t) => t === 'site_events' || t === 'site_sessions')).toBe(true);
      expect(s.sql).not.toMatch(/visitor_events|bookings|partners|pending_registrations/);
    }
  });

  it('reports storage as plain numbers, with no oldest day when empty', async () => {
    const { db, service } = setup();
    db.$queryRaw.mockResolvedValueOnce([
      { events: 104_452, sessions: 28_753, bytes: 41_574_400, oldest: '2026-08-24' },
    ]);
    await expect(service.storage()).resolves.toEqual({
      events: 104_452,
      sessions: 28_753,
      bytes: 41_574_400,
      oldest: '2026-08-24',
    });
    db.$queryRaw.mockResolvedValueOnce([{ events: 0, sessions: 0, bytes: 49_152, oldest: null }]);
    await expect(service.storage()).resolves.toEqual({
      events: 0,
      sessions: 0,
      bytes: 49_152,
      oldest: null,
    });
  });
});
