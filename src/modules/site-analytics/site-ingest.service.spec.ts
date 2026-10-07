import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '@/prisma/prisma.service';
import { DEFAULT_PULSE_KEY, parsePulseKey, sealPulse } from './pulse-codec';
import { PartnerSlugCache } from './partner-slug-cache.service';
import { SiteIngestService, clientTime } from './site-ingest.service';

/**
 * The service end of the beacon against an in-memory Prisma double with real
 * transaction semantics: what a session row may contain (never the raw IP or
 * User-Agent), when a session is created versus touched, that a session never
 * exists without an event, how events are attributed — and that nothing, not
 * even a database failure, escapes to the caller.
 */
const KEY = parsePulseKey(DEFAULT_PULSE_KEY)!;
const SID = '3f2b8c1e-5d4a-4f6b-9c7d-1a2b3c4d5e6f';
const VID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const IP = '5.77.192.10';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

type Row = Record<string, unknown>;
type CreateMany = { data: Row[]; skipDuplicates?: boolean };

function setup(
  opts: {
    sessions?: string[];
    events?: string[];
    failSessions?: Error;
    failEvents?: Error;
  } = {},
) {
  const state = {
    sessions: new Map<string, Row>((opts.sessions ?? []).map((id) => [id, { id }])),
    events: new Map<string, Row>((opts.events ?? []).map((id) => [id, { id }])),
  };
  /** INSERT … ON CONFLICT (id) DO NOTHING. */
  const insert = (table: Map<string, Row>, rows: Row[]) => {
    let count = 0;
    for (const row of rows) {
      if (table.has(row.id as string)) continue;
      table.set(row.id as string, row);
      count++;
    }
    return { count };
  };
  const tables = {
    siteSession: {
      createMany: jest.fn(async ({ data }: CreateMany) => {
        if (opts.failSessions) throw opts.failSessions;
        return insert(state.sessions, data);
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = state.sessions.get(where.id);
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      }),
    },
    siteEvent: {
      createMany: jest.fn(async ({ data }: CreateMany) => {
        if (opts.failEvents) throw opts.failEvents;
        return insert(state.events, data);
      }),
    },
    partner: {
      findMany: jest.fn(async () => [{ id: 'partner-antheris', slug: 'antheris' }]),
    },
  };
  const db = {
    ...tables,
    // All or nothing, as in Postgres: a throw puts back the state from before.
    $transaction: jest.fn(async (fn: (tx: typeof tables) => Promise<unknown>) => {
      const sessions = new Map([...state.sessions].map(([k, v]) => [k, { ...v }]));
      const events = new Map(state.events);
      try {
        return await fn(tables);
      } catch (e) {
        state.sessions = sessions;
        state.events = events;
        throw e;
      }
    }),
  };
  const prisma = db as unknown as PrismaService;
  const config = { get: () => '' } as unknown as ConfigService;
  const service = new SiteIngestService(prisma, new PartnerSlugCache(prisma), config);
  const warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  return { db, state, service, warn };
}

let seq = 0;
const ev = (n: string, x: Row, extra: Row = {}) => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  n,
  t: Date.now() - 1_000,
  p: '/p/antheris',
  h: 'reserva.am',
  x,
  ...extra,
});

const seal = (batch: unknown) => sealPulse(JSON.stringify(batch), KEY);
const batch = (e: unknown[], s: Row = {}, sid = SID) => ({
  v: 1,
  sid,
  vid: VID,
  s: {
    ref: 'https://l.instagram.com/',
    lp: '/p/antheris?utm_source=ig',
    lh: 'reserva.am',
    lang: 'hy-AM',
    sw: 390,
    sh: 844,
    ...s,
  },
  e,
});

describe('SiteIngestService.ingest', () => {
  it('creates the session on first sight with derived context and no raw IP / User-Agent', async () => {
    const { db, state, service } = setup();
    await service.ingest(
      seal(
        batch([ev('page_view', { pt: 'partner' }, { ps: 'antheris' })], {
          utm: { source: 'ig', campaign: 'autumn' },
        }),
      ),
      IP,
      IPHONE,
    );

    const row = state.sessions.get(SID)!;
    expect(row).toMatchObject({
      id: SID,
      visitorId: VID,
      landingPath: '/p/antheris?utm_source=ig',
      landingHost: 'reserva.am',
      referrer: 'https://l.instagram.com/',
      referrerHost: 'l.instagram.com',
      channel: 'instagram',
      utmSource: 'ig',
      utmCampaign: 'autumn',
      utmMedium: null,
      deviceType: 'mobile',
      browser: 'Mobile Safari',
      os: 'iOS',
      language: 'hy-AM',
      screenW: 390,
      screenH: 844,
      isBot: false,
      isInternal: false,
    });
    expect(Object.keys(row)).toEqual(expect.arrayContaining(['country', 'city']));
    // Privacy: the raw inputs are used, never kept.
    const stored = JSON.stringify(row);
    expect(stored).not.toContain(IP);
    expect(stored).not.toContain('AppleWebKit');
    expect(Object.keys(row).some((k) => /^(ip|userAgent|ua)$/i.test(k))).toBe(false);
    expect(state.events.size).toBe(1);
    expect(db.siteSession.updateMany).not.toHaveBeenCalled();
  });

  it('touches only lastSeenAt when a known session sends new events', async () => {
    const { db, state, service } = setup({ sessions: [SID] });
    await service.ingest(seal(batch([ev('book_click', { from: 'hero' })])), IP, IPHONE);
    expect(db.siteSession.updateMany).toHaveBeenCalledWith({
      where: { id: SID },
      data: { lastSeenAt: expect.any(Date) },
    });
    expect(state.events.size).toBe(1);
  });

  it('stores events deduped on their id, attributed by slug, with server time', async () => {
    const { db, service } = setup();
    const known = ev('book_click', { from: 'services', svc: SID }, { ps: 'Antheris' });
    const unknown = ev('page_view', { pt: 'partner' }, { ps: 'no-such-salon' });
    const nowhere = ev('salons_search', { q: 'nails' }, { p: '/salons' });
    const skewed = ev('page_view', { pt: 'home' }, { t: 42 });
    await service.ingest(seal(batch([known, unknown, nowhere, skewed, { ...known }])), IP, IPHONE);

    expect(db.siteEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    const rows = db.siteEvent.createMany.mock.calls[0][0].data;
    expect(rows.map((r) => r.id)).toEqual([known.id, unknown.id, nowhere.id, skewed.id]);
    expect(rows.map((r) => r.partnerId)).toEqual(['partner-antheris', null, null, null]);
    expect(rows[0]).toMatchObject({
      sessionId: SID,
      visitorId: VID,
      name: 'book_click',
      path: '/p/antheris',
      host: 'reserva.am',
      props: { from: 'services', svc: SID },
    });
    expect(rows[0].clientAt).toEqual(new Date(known.t));
    expect(rows[3].clientAt).toBeNull(); // 1970 is not a plausible client clock
    expect(rows.every((r) => r.createdAt instanceof Date)).toBe(true);
  });

  it('flags bots and staff traffic', async () => {
    const { state, service } = setup();
    await service.ingest(
      seal(batch([ev('page_view', { pt: 'home' })], { int: true })),
      IP,
      'Mozilla/5.0 (compatible; Googlebot/2.1)',
    );
    expect(state.sessions.get(SID)).toMatchObject({ isBot: true, isInternal: true });
  });

  it('writes nothing for a tampered, invalid or empty payload', async () => {
    const { db, state, service } = setup();
    const good = seal(batch([ev('page_view', { pt: 'home' })]));
    const bytes = Buffer.from(good, 'base64url');
    bytes[20] ^= 0xff;
    for (const body of [
      bytes.toString('base64url'),
      'garbage',
      '',
      undefined,
      seal({ v: 2, sid: SID, vid: VID, s: {}, e: [ev('page_view', { pt: 'home' })] }),
    ]) {
      await service.ingest(body, IP, IPHONE);
    }
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(state.sessions.size + state.events.size).toBe(0);
  });

  it('creates no session for a batch with no valid event left after validation', async () => {
    const { db, state, service } = setup();
    await service.ingest(
      seal(batch([ev('mouse_move', {}), ev('page_view', { pt: 'nope' })])),
      IP,
      IPHONE,
    );
    expect(db.siteSession.createMany).not.toHaveBeenCalled();
    expect(state.sessions.size).toBe(0);
  });

  it('rolls back a new session when none of its events is new (a replay under a fresh id)', async () => {
    const replayed = ev('page_view', { pt: 'partner' });
    const { state, service, warn } = setup({ events: [replayed.id] });
    const fresh = '11111111-2222-4333-8444-555555555555';
    await expect(
      service.ingest(seal(batch([replayed], {}, fresh)), IP, IPHONE),
    ).resolves.toBeUndefined();
    expect(state.sessions.has(fresh)).toBe(false);
    expect(warn).not.toHaveBeenCalled(); // an expected outcome, not an error
  });

  it('leaves a known session untouched when a retry brings nothing new', async () => {
    const retried = ev('page_view', { pt: 'partner' });
    const { db, state, service } = setup({ sessions: [SID], events: [retried.id] });
    await service.ingest(seal(batch([retried])), IP, IPHONE);
    expect(db.siteSession.updateMany).not.toHaveBeenCalled();
    expect(state.sessions.get(SID)).toEqual({ id: SID });
  });

  it('never leaves a session behind when its events fail to store', async () => {
    const { state, service, warn } = setup({ failEvents: new Error('connection reset') });
    await expect(
      service.ingest(seal(batch([ev('page_view', { pt: 'home' })])), IP, IPHONE),
    ).resolves.toBeUndefined();
    expect(state.sessions.size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('never throws, even when the database does', async () => {
    const { service } = setup({ failSessions: new Error('connection refused') });
    await expect(
      service.ingest(seal(batch([ev('page_view', { pt: 'home' })])), IP, IPHONE),
    ).resolves.toBeUndefined();
  });
});

describe('clientTime', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  it('keeps a plausible client clock and drops an implausible one', () => {
    expect(clientTime(now.getTime() - 5 * 60_000, now)).toEqual(
      new Date(now.getTime() - 5 * 60_000),
    );
    // A phone clock running an hour fast is still believable.
    expect(clientTime(now.getTime() + 60 * 60_000, now)).toEqual(
      new Date(now.getTime() + 60 * 60_000),
    );
    expect(clientTime(now.getTime() - 8 * 24 * 60 * 60_000, now)).toBeNull();
    expect(clientTime(now.getTime() + 2 * 24 * 60 * 60_000, now)).toBeNull();
    expect(clientTime(0, now)).toBeNull();
    expect(clientTime(undefined, now)).toBeNull();
  });
});
