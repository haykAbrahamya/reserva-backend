import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '@/auth/decorators';
import type { PrismaService } from '@/prisma/prisma.service';
import { PlatformAuthGuard } from '../guards/platform-auth.guard';
import { decodeBookingCursor, encodeBookingCursor } from './booking-cursor';
import { recentBookingsQuerySchema } from './dto/recent-bookings.dto';
import { PlatformBookingsController } from './platform-bookings.controller';
import { PlatformBookingsService, type RecentBooking } from './platform-bookings.service';

/**
 * The console's cross-partner booking feed. Paging is keyset-based, so the
 * tests run the service against an in-memory table that executes the very
 * `where` / `orderBy` / `take` it sends — ties on createdAt, rows arriving
 * mid-paging and soft-deleted partners included.
 */

interface Row {
  id: string;
  createdAt: Date;
  startAt: Date;
  status: string;
  source: string;
  priceAtBooking: number;
  priceMaxAtBooking: number | null;
  priceTypeAtBooking: string | null;
  // Personal data the feed must never return.
  clientName: string;
  clientPhone: string;
  notes: string | null;
  partner: { id: string; name: string; slug: string | null; kind: string; deletedAt: Date | null };
  location: { id: string; name: string };
  service: { id: string; name: string; priceType: string };
  specialist: { id: string; name: string } | null;
}

type Where = {
  partner?: { deletedAt: null };
  OR?: ({ createdAt: { lt: Date } } | { createdAt: Date; id: { lt: string } })[];
};

const uuid = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 10, minute, 0, 0));
const ANTHERIS = {
  id: 'p-antheris',
  name: 'Antheris',
  slug: 'antheris',
  kind: 'salon',
  deletedAt: null,
};
const GONE = {
  id: 'p-gone',
  name: 'Old Town Beauty',
  slug: 'oldtown',
  kind: 'salon',
  deletedAt: new Date(),
};

let next = 0;
function row(minute: number, over: Partial<Row> = {}): Row {
  next++;
  return {
    id: uuid(next),
    createdAt: at(minute),
    startAt: at(minute + 24 * 60),
    status: 'confirmed',
    source: 'public',
    priceAtBooking: 12_000,
    priceMaxAtBooking: null,
    priceTypeAtBooking: 'fixed',
    clientName: 'Anna Petrosyan',
    clientPhone: '+37491000000',
    notes: 'Allergic to latex',
    partner: ANTHERIS,
    location: { id: 'loc-1', name: 'Arabkir' },
    service: { id: 'svc-1', name: 'Gel polish manicure', priceType: 'fixed' },
    specialist: { id: 'sp-1', name: 'Naira Hovhannisyan' },
    ...over,
  };
}

/** A booking table that answers findMany the way Postgres would for this query. */
function setup(rows: Row[]) {
  const table = [...rows];
  const matches = (r: Row, where: Where) => {
    if (where.partner && r.partner.deletedAt !== null) return false;
    if (!where.OR) return true;
    return where.OR.some((c) =>
      c.createdAt instanceof Date
        ? r.createdAt.getTime() === c.createdAt.getTime() &&
          r.id < (c as { id: { lt: string } }).id.lt
        : r.createdAt.getTime() < c.createdAt.lt.getTime(),
    );
  };
  const findMany = jest.fn(
    async (args: { where: Where; take: number; select: Record<string, unknown> }) =>
      table
        .filter((r) => matches(r, args.where))
        .sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
        )
        .slice(0, args.take),
  );
  const service = new PlatformBookingsService({
    booking: { findMany },
  } as unknown as PrismaService);
  const recent = (limit: number, cursor?: string) =>
    service.recent(recentBookingsQuerySchema.parse({ limit: String(limit), cursor }));
  return { table, findMany, service, recent };
}

/** Every page, following nextCursor to the end. */
async function pageThrough(
  recent: (
    limit: number,
    cursor?: string,
  ) => Promise<{ items: RecentBooking[]; nextCursor: string | null }>,
  limit: number,
) {
  const pages: RecentBooking[][] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 100; guard++) {
    const page = await recent(limit, cursor);
    pages.push(page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return pages;
}

describe('PlatformBookingsService.recent', () => {
  // Ten bookings, with three sharing one minute and two sharing another.
  const seed = () => [
    row(1),
    row(5),
    row(5),
    row(5),
    row(9),
    row(12),
    row(12),
    row(20),
    row(31),
    row(40),
  ];

  it('lists newest first by createdAt, then id', async () => {
    const rows = seed();
    const { recent } = setup(rows);
    const { items } = await recent(50);
    const expected = [...rows].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1),
    );
    expect(items.map((b) => b.id)).toEqual(expected.map((b) => b.id));
  });

  it('pages through ties without a duplicate or a gap, and ends with a null cursor', async () => {
    const rows = seed();
    const { recent } = setup(rows);
    const all = (await recent(50)).items.map((b) => b.id);
    for (const limit of [1, 2, 3, 4, 5, 7]) {
      const pages = await pageThrough(recent, limit);
      const ids = pages.flat().map((b) => b.id);
      expect(ids).toEqual(all);
      expect(new Set(ids).size).toBe(ids.length);
      expect(pages.slice(0, -1).every((p) => p.length === limit)).toBe(true);
    }
  });

  it('keeps paging steady while new bookings arrive', async () => {
    const rows = seed();
    const { table, recent } = setup(rows);
    const before = (await recent(50)).items.map((b) => b.id);

    const first = await recent(4);
    // New bookings land between page requests — later, and one at the very
    // instant the first page ended on.
    const boundary = table.find((r) => r.id === first.items[3].id)!;
    table.push(row(50), row(60), { ...row(0), createdAt: boundary.createdAt, id: uuid(999) });
    const rest = await pageThrough(
      (limit, cursor) => recent(limit, cursor ?? first.nextCursor!),
      4,
    );

    const seen = [...first.items, ...rest.flat()].map((b) => b.id);
    expect(seen.filter((id) => before.includes(id))).toEqual(before);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('asks for one row more than the page to know whether another exists', async () => {
    const { findMany, recent } = setup(seed());
    await recent(5);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      take: 6,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect((await recent(10)).nextCursor).toBeNull(); // exactly ten: no further page
  });

  it('leaves out bookings of soft-deleted partners', async () => {
    const { recent } = setup([row(1), row(2, { partner: GONE }), row(3)]);
    const { items } = await recent(50);
    expect(items).toHaveLength(2);
    expect(items.every((b) => b.partner.id === ANTHERIS.id)).toBe(true);
  });

  it('returns the contract shape, with the price snapshot', async () => {
    const { recent } = setup([
      row(1),
      row(2, {
        priceTypeAtBooking: null, // booked before the type was snapshotted → the service's
        service: { id: 'svc-2', name: 'Chemical peel', priceType: 'range' },
        priceAtBooking: 20_000,
        priceMaxAtBooking: 45_000,
        specialist: null,
        source: 'backoffice',
        status: 'pending',
      }),
    ]);
    const [range, fixed] = (await recent(5)).items;
    expect(range).toEqual({
      id: expect.any(String),
      createdAt: '2026-10-01T10:02:00.000Z',
      startAt: '2026-10-02T10:02:00.000Z',
      status: 'pending',
      source: 'backoffice',
      partner: { id: 'p-antheris', name: 'Antheris', slug: 'antheris', kind: 'salon' },
      location: { id: 'loc-1', name: 'Arabkir' },
      service: { id: 'svc-2', name: 'Chemical peel' },
      specialist: null,
      price: { type: 'range', amount: 20_000, max: 45_000 },
    });
    expect(fixed.price).toEqual({ type: 'fixed', amount: 12_000, max: null });
    expect(fixed.specialist).toEqual({ id: 'sp-1', name: 'Naira Hovhannisyan' });
  });

  it('never returns personal data, and never even selects it', async () => {
    const { findMany, recent } = setup(seed());
    const page = await recent(50);
    const json = JSON.stringify(page);
    for (const secret of ['Anna Petrosyan', '+37491000000', 'Allergic to latex'])
      expect(json).not.toContain(secret);
    const keys = new Set(page.items.flatMap((b) => Object.keys(b)));
    expect([...keys].sort()).toEqual([
      'createdAt',
      'id',
      'location',
      'partner',
      'price',
      'service',
      'source',
      'specialist',
      'startAt',
      'status',
    ]);
    const select = JSON.stringify(findMany.mock.calls[0][0].select);
    expect(select).not.toMatch(/client|phone|email|notes/i);
  });
});

describe('recent bookings query', () => {
  const parse = (q: Record<string, unknown>) => recentBookingsQuerySchema.safeParse(q);

  it('defaults to 5 and accepts 1..50', () => {
    expect(parse({}).success && parse({}).data).toEqual({ limit: 5, cursor: undefined });
    expect(parse({ limit: '1' }).success).toBe(true);
    expect(parse({ limit: '50' }).success).toBe(true);
  });

  it('rejects a limit outside 1..50 or not a whole number', () => {
    for (const limit of ['0', '51', '-1', '2.5', 'ten'])
      expect(parse({ limit }).success).toBe(false);
  });

  it('rejects a cursor it did not issue; an empty one means the first page', () => {
    expect(parse({ cursor: 'garbage!' }).success).toBe(false);
    expect(parse({ cursor: Buffer.from('not|a|cursor').toString('base64url') }).success).toBe(
      false,
    );
    const good = encodeBookingCursor({ createdAt: at(5), id: uuid(3) });
    const withCursor = parse({ cursor: good });
    expect(withCursor.success && withCursor.data.cursor).toBe(good);
    const empty = parse({ cursor: '' });
    expect(empty.success).toBe(true);
    expect(empty.data?.cursor).toBeUndefined();
  });
});

describe('booking cursor', () => {
  it('round-trips the exact instant and id', () => {
    const c = {
      createdAt: new Date('2026-10-06T17:54:27.792Z'),
      id: '01a1126b-a870-7688-b747-b10953a0abc0',
    };
    const encoded = encodeBookingCursor(c);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeBookingCursor(encoded)).toEqual(c);
  });

  it('refuses anything else', () => {
    const enc = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
    for (const raw of [
      '',
      '!!!',
      `${enc('2026-10-06T17:54:27.792Z|01a1126b-a870-7688-b747-b10953a0abc0')}=`, // padding
      enc('2026-10-06T17:54:27.792Z'), // no id
      enc('2026-10-06T17:54:27.792Z|01a1126b-a870-7688-b747-b10953a0abc0|x'), // extra part
      enc('2026-10-06|01a1126b-a870-7688-b747-b10953a0abc0'), // not our ISO form
      enc('2026-13-06T17:54:27.792Z|01a1126b-a870-7688-b747-b10953a0abc0'), // no such date
      enc('2026-10-06T17:54:27.792Z|1; DROP TABLE bookings'), // not an id
      'A'.repeat(201),
    ]) {
      expect(decodeBookingCursor(raw)).toBeNull();
    }
  });
});

describe('PlatformBookingsController', () => {
  it('is a platform route at /platform/bookings, behind the platform auth guard', () => {
    expect(Reflect.getMetadata(PATH_METADATA, PlatformBookingsController)).toBe(
      'platform/bookings',
    );
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, PlatformBookingsController)).toBe(true); // skips the tenant guard…
    expect(Reflect.getMetadata(GUARDS_METADATA, PlatformBookingsController)).toEqual([
      PlatformAuthGuard,
    ]); // …not this one
    expect(Reflect.getMetadata(PATH_METADATA, PlatformBookingsController.prototype.recent)).toBe(
      'recent',
    );
  });
});
