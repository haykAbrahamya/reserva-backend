import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '@/prisma/prisma.service';
import {
  SiteSessionsService,
  labelIds,
  toSessionRow,
  type RawSession,
} from './site-sessions.service';

/**
 * The "person view" (contract §11). The SQL runs against Postgres in the
 * end-to-end check; here it is captured, not executed — these pin how a row
 * is summarised, which filter becomes which predicate, how events are
 * ordered, where labels are looked up, and the 404.
 */
const raw = (over: Partial<RawSession> = {}): RawSession => ({
  id: 's1',
  visitorId: 'v1',
  channel: 'instagram',
  utmCampaign: 'autumn',
  referrerHost: 'l.instagram.com',
  deviceType: 'mobile',
  browser: 'Instagram',
  os: 'iOS',
  country: 'AM',
  city: 'Yerevan',
  language: 'hy-AM',
  landingPath: '/',
  landingHost: 'antheris.reserva.am',
  isInternal: false,
  startedAt: new Date('2026-10-01T10:00:00Z'),
  lastSeenAt: new Date('2026-10-01T10:05:00Z'),
  firstAt: new Date('2026-10-01T10:00:00.400Z'),
  lastAt: new Date('2026-10-01T10:03:30.100Z'),
  eventCount: 9,
  pageViews: 2,
  booked: true,
  contacted: false,
  signedUp: null,
  bookClicked: true,
  journey: ['page_view', 'category_select', 'book_click', 'booking_open'],
  partners: [{ id: 'p1', name: 'Antheris', slug: 'antheris' }],
  visitorSessions: 3,
  ...over,
});

describe('toSessionRow', () => {
  it('summarises a session from its first and last event', () => {
    const row = toSessionRow(raw());
    expect(row).toMatchObject({
      id: 's1',
      visitorId: 'v1',
      startedAt: '2026-10-01T10:00:00.400Z',
      lastSeenAt: '2026-10-01T10:03:30.100Z',
      durationSec: 210,
      eventCount: 9,
      pageViews: 2,
      visitorSessions: 3,
      partners: [{ id: 'p1', name: 'Antheris', slug: 'antheris' }],
    });
  });

  it('turns the aggregate flags into a strict outcome', () => {
    expect(toSessionRow(raw()).outcome).toEqual({
      booked: true,
      contacted: false,
      signedUp: false,
      bookClicked: true,
    });
    expect(
      toSessionRow(raw({ booked: null, contacted: true, signedUp: true, bookClicked: false }))
        .outcome,
    ).toEqual({
      booked: false,
      contacted: true,
      signedUp: true,
      bookClicked: false,
    });
  });

  it('caps partners at 5 and the journey at 12', () => {
    const partners = Array.from({ length: 7 }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      slug: null,
    }));
    const journey = Array.from({ length: 15 }, () => 'page_view');
    const row = toSessionRow(raw({ partners, journey }));
    expect(row.partners.map((p) => p.id)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
    expect(row.journey).toHaveLength(12);
  });

  it('never reports a negative duration, and falls back to the session columns without events', () => {
    expect(toSessionRow(raw({ lastAt: new Date('2026-10-01T09:59:00Z') })).durationSec).toBe(0);
    const empty = toSessionRow(
      raw({
        firstAt: null,
        lastAt: null,
        eventCount: null,
        pageViews: null,
        booked: null,
        bookClicked: null,
        journey: null,
        partners: null,
        visitorSessions: null,
      }),
    );
    expect(empty).toMatchObject({
      startedAt: '2026-10-01T10:00:00.000Z',
      lastSeenAt: '2026-10-01T10:05:00.000Z',
      durationSec: 300,
      eventCount: 0,
      pageViews: 0,
      partners: [],
      journey: [],
      visitorSessions: 0,
      outcome: { booked: false, contacted: false, signedUp: false, bookClicked: false },
    });
  });
});

describe('labelIds', () => {
  it('collects each catalog id once, per prop', () => {
    expect(
      labelIds([
        { props: { from: 'services', svc: 'svc-1', loc: 'loc-1' } },
        { props: { svc: 'svc-1', sp: 'sp-1' } },
        { props: { course: 'course-1' } },
        { props: { pt: 'partner' } },
      ]),
    ).toEqual({ svc: ['svc-1'], sp: ['sp-1'], loc: ['loc-1'], course: ['course-1'] });
  });

  it('ignores anything that is not a non-empty string', () => {
    expect(
      labelIds([{ props: { svc: 42, sp: '', loc: null, course: ['x'] } }, { props: {} }]),
    ).toEqual({
      svc: [],
      sp: [],
      loc: [],
      course: [],
    });
  });
});

/** A service over a $queryRaw double that answers by what the SQL is for. */
function setup(
  answers: {
    describe?: unknown[];
    page?: unknown[];
    total?: number;
    timeline?: unknown[];
    labels?: unknown[];
    others?: unknown[];
  } = {},
) {
  const queries: Prisma.Sql[] = [];
  const $queryRaw = jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = Prisma.sql(strings, ...values);
    queries.push(sql);
    const text = sql.sql;
    if (text.includes('WITH ev AS')) return answers.describe ?? [];
    if (text.includes('ORDER BY "firstAt" DESC')) return answers.page ?? [];
    if (text.includes('AS "total"')) return [{ total: answers.total ?? 0 }];
    if (text.includes('UNION ALL') || text.includes('AS "label"')) return answers.labels ?? [];
    if (text.includes('"visitorId" =')) return answers.others ?? [];
    if (text.includes('WHERE e."sessionId" =')) return answers.timeline ?? [];
    throw new Error(`unexpected query: ${text}`);
  });
  const service = new SiteSessionsService({ $queryRaw } as unknown as PrismaService);
  const find = (needle: string) => queries.find((q) => q.sql.includes(needle))!;
  return { service, queries, find };
}

const range = {
  from: '2026-09-01',
  to: '2026-09-30',
  page: 1,
  pageSize: 25,
  includeInternal: false,
};

describe('SiteSessionsService.list — filters', () => {
  it('a bounced session is exactly one event, and that one a page view', async () => {
    const { service, find } = setup();
    await service.list({ ...range, outcome: 'bounced' });
    expect(find('ORDER BY "firstAt" DESC').sql).toContain(
      `HAVING count(*) = 1 AND bool_and(e."name" = 'page_view')`,
    );
  });

  it.each([
    ['booked', `HAVING bool_or(e."name" = 'booking_success')`],
    ['contacted', `HAVING bool_or(e."name" = 'contact_click')`],
    ['signup', `HAVING bool_or(e."name" = 'signup_success')`],
    ['bookclick', `HAVING bool_or(e."name" IN ('book_click', 'booking_open'))`],
  ] as const)('outcome=%s → %s', async (outcome, having) => {
    const { service, find } = setup();
    await service.list({ ...range, outcome });
    expect(find('ORDER BY "firstAt" DESC').sql).toContain(having);
  });

  it('always leaves bots out; staff only with includeInternal', async () => {
    const plain = setup();
    await plain.service.list(range);
    expect(plain.find('ORDER BY "firstAt" DESC').sql).toContain(
      `NOT s."isBot" AND NOT s."isInternal"`,
    );
    const staff = setup();
    await staff.service.list({ ...range, includeInternal: true });
    const sql = staff.find('ORDER BY "firstAt" DESC').sql;
    expect(sql).toContain(`NOT s."isBot"`);
    expect(sql).not.toContain('isInternal');
  });

  it('binds partner and channel as parameters, never as SQL text', async () => {
    const { service, find } = setup();
    const partnerId = '01a1126b-893b-76b8-8e94-3c9338a75678';
    await service.list({ ...range, partnerId, channel: 'instagram' });
    const page = find('ORDER BY "firstAt" DESC');
    expect(page.sql).toContain(`AND s."channel" = ?`);
    expect(page.sql).toContain(`AND e."partnerId" = ?`);
    expect(page.values).toEqual(
      expect.arrayContaining(['instagram', partnerId, '2026-09-01', '2026-10-01', 25, 0]),
    );
    expect(page.sql).not.toContain(partnerId);
  });

  it('pages newest first and keeps that order in the rows', async () => {
    const { service, find } = setup({
      page: [{ id: 's2' }, { id: 's1' }],
      total: 2,
      describe: [raw({ id: 's1' }), raw({ id: 's2' })],
    });
    const result = await service.list({ ...range, page: 1, pageSize: 2 });
    expect(find('ORDER BY "firstAt" DESC').sql).toMatch(
      /ORDER BY "firstAt" DESC, "id" DESC\s+LIMIT \? OFFSET \?/,
    );
    expect(result.items.map((r) => r.id)).toEqual(['s2', 's1']);
    expect(result).toMatchObject({ total: 2, page: 1, pageSize: 2, pageCount: 1 });
  });
});

describe('SiteSessionsService.detail', () => {
  it('is a 404 for an unknown session', async () => {
    const { service } = setup({ describe: [] });
    const error = await service.detail('nope').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(404);
  });

  it('orders events by the client clock, then the server clock, then the id', async () => {
    const { service, find } = setup({ describe: [raw()] });
    await service.detail('s1');
    expect(find('WHERE e."sessionId" =').sql).toMatch(
      /ORDER BY COALESCE\(e\."clientAt", e\."createdAt"\), e\."createdAt", e\."id"\s*$/,
    );
  });

  it('labels each id from its own table and returns the timeline and other visits', async () => {
    const at = new Date('2026-10-01T10:00:01Z');
    const { service, find } = setup({
      describe: [raw()],
      timeline: [
        {
          id: 'e1',
          name: 'book_click',
          createdAt: at,
          clientAt: null,
          path: '/',
          host: 'antheris.reserva.am',
          props: { from: 'services', svc: 'svc-1', loc: 'loc-1' },
          partnerId: 'p1',
          partnerName: 'Antheris',
          partnerSlug: 'antheris',
        },
        {
          id: 'e2',
          name: 'booking_success',
          createdAt: at,
          clientAt: at,
          path: '/',
          host: 'antheris.reserva.am',
          props: { svc: 'svc-1', sp: 'sp-1' },
          partnerId: null,
          partnerName: null,
          partnerSlug: null,
        },
      ],
      labels: [
        { id: 'svc-1', label: 'Gel polish manicure' },
        { id: 'sp-1', label: 'Naira Hovhannisyan' },
        { id: 'loc-1', label: 'Cascade' },
      ],
      others: [
        {
          id: 's0',
          channel: 'direct',
          startedAt: new Date('2026-09-28T18:00:00Z'),
          eventCount: 4,
          booked: false,
        },
      ],
    });
    const detail = await service.detail('s1');

    expect(detail.labels).toEqual({
      'svc-1': 'Gel polish manicure',
      'sp-1': 'Naira Hovhannisyan',
      'loc-1': 'Cascade',
    });
    const labels = find('AS "label"');
    expect(labels.sql).toMatch(
      /FROM "services" WHERE "id" IN \(\?\) UNION ALL SELECT "id", "name" AS "label" FROM "specialists" WHERE "id" IN \(\?\) UNION ALL SELECT "id", "name" AS "label" FROM "locations"/,
    );
    expect(labels.sql).not.toContain('"courses"'); // no course id → no lookup
    expect(labels.values).toEqual(['svc-1', 'sp-1', 'loc-1']);

    expect(detail.events.map((e) => [e.id, e.at, e.clientAt, e.partner?.slug ?? null])).toEqual([
      ['e1', at.toISOString(), null, 'antheris'],
      ['e2', at.toISOString(), at.toISOString(), null],
    ]);
    expect(detail.otherSessions).toEqual([
      {
        id: 's0',
        channel: 'direct',
        startedAt: '2026-09-28T18:00:00.000Z',
        eventCount: 4,
        booked: false,
      },
    ]);
    // The visitor's other visits leave out this one and any bot.
    expect(find('LIMIT 20').sql).toMatch(
      /s\."visitorId" = \? AND s\."id" <> \? AND NOT s\."isBot"/,
    );
  });

  it('skips the label lookup when the events name no catalog row', async () => {
    const { service, queries } = setup({
      describe: [raw()],
      timeline: [
        {
          id: 'e1',
          name: 'page_view',
          createdAt: new Date(),
          clientAt: null,
          path: '/',
          host: 'h',
          props: { pt: 'home' },
          partnerId: null,
          partnerName: null,
          partnerSlug: null,
        },
      ],
    });
    expect((await service.detail('s1')).labels).toEqual({});
    expect(queries.some((q) => q.sql.includes('AS "label"'))).toBe(false);
  });
});
