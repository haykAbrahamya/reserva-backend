import {
  EVENT_PROPS,
  MAX_BATCH_EVENTS,
  parseBatch,
  parseEvent,
  type SiteEventName,
} from './pulse-batch';

/**
 * The batch schema is the real protection behind the beacon (the cipher key is
 * public). These pin the contract's two-level rule — a bad envelope drops the
 * batch, a bad event drops only itself — and that nothing outside the catalog
 * is ever kept.
 */
const SID = '3f2b8c1e-5d4a-4f6b-9c7d-1a2b3c4d5e6f';
const VID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const SVC = '01a1126b-a870-7688-b747-b10953a0abc0';
let seq = 0;
const eventId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

const event = (n: string, x?: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: eventId(),
  n,
  t: 1_760_000_000_000,
  p: '/',
  h: 'reserva.am',
  ...(x === undefined ? {} : { x }),
  ...extra,
});

const batch = (e: unknown[], overrides: Record<string, unknown> = {}) => ({
  v: 1,
  sid: SID,
  vid: VID,
  s: { ref: '', lp: '/', lh: 'reserva.am', lang: 'hy-AM', sw: 390, sh: 844 },
  e,
  ...overrides,
});

/** One contract-conforming example per catalogued event. */
const EXAMPLES: Record<SiteEventName, Record<string, unknown>> = {
  page_view: { pt: 'partner' },
  book_click: { from: 'hero', svc: SVC, sp: SVC, loc: SVC },
  contact_click: { ch: 'whatsapp', from: 'footer', loc: SVC },
  branch_switch: { loc: SVC },
  category_select: { cat: 'Nails' },
  service_search: { q: 'gel' },
  specialist_open: { sp: SVC },
  gallery_open: { kind: 'works' },
  course_open: { course: SVC },
  course_register_click: { course: SVC },
  booking_open: { from: 'services', svc: SVC },
  booking_step: { step: 'datetime' },
  booking_submit: { svc: SVC, sp: SVC, loc: SVC, any: true },
  booking_success: { svc: SVC, loc: SVC },
  booking_error: { code: 'slot_taken' },
  booking_close: { step: 'details' },
  signup_start: {},
  signup_step: { step: 'company' },
  signup_submit: {},
  signup_error: { field: 'slug', code: 'taken' },
  signup_success: {},
  salons_search: { q: 'barber' },
  salons_filter: { cat: 'hair', area: 'yerevan-arabkir' },
  salon_click: { slug: 'antheris', pos: 3 },
};

describe('parseBatch — the event catalog', () => {
  it('has an example for every catalogued event, and accepts each one', () => {
    expect(Object.keys(EXAMPLES).sort()).toEqual(Object.keys(EVENT_PROPS).sort());
    const events = Object.entries(EXAMPLES).map(([n, x]) => event(n, x));
    for (let i = 0; i < events.length; i += MAX_BATCH_EVENTS) {
      const parsed = parseBatch(batch(events.slice(i, i + MAX_BATCH_EVENTS)));
      expect(parsed?.events).toHaveLength(Math.min(MAX_BATCH_EVENTS, events.length - i));
    }
    for (const [n, x] of Object.entries(EXAMPLES)) {
      expect(parseEvent(event(n, x))?.props).toEqual(x);
    }
  });

  it('accepts the no-prop events with x omitted', () => {
    for (const n of ['signup_start', 'signup_submit', 'signup_success', 'gallery_open']) {
      expect(parseEvent(event(n))?.props).toEqual({});
    }
  });

  it('maps the short wire keys onto a parsed event', () => {
    const parsed = parseEvent(
      event('page_view', { pt: 'home' }, { ps: 'antheris', p: '/p/antheris' }),
    );
    expect(parsed).toMatchObject({
      name: 'page_view',
      clientTime: 1_760_000_000_000,
      path: '/p/antheris',
      host: 'reserva.am',
      partnerSlug: 'antheris',
      props: { pt: 'home' },
    });
  });
});

describe('parseBatch — an invalid event drops only itself', () => {
  it('drops unknown event names and keeps the rest', () => {
    const parsed = parseBatch(
      batch([
        event('page_view', { pt: 'home' }),
        event('mouse_move', {}),
        event('__proto__', {}),
        event('book_click', { from: 'hero' }),
      ]),
    );
    expect(parsed?.events.map((e) => e.name)).toEqual(['page_view', 'book_click']);
  });

  it('drops events whose props break the catalog', () => {
    const bad = [
      event('page_view', { pt: 'checkout' }), // not a page type
      event('page_view'), // pt is required
      event('book_click', { from: 'hero', svc: 'not-a-uuid' }),
      event('contact_click', { ch: 'sms' }),
      event('contact_click', { ch: 'call', from: 'x'.repeat(25) }),
      event('booking_step', { step: 'payment' }),
      event('booking_submit', { any: 'yes' }),
      event('service_search', { q: 'q'.repeat(61) }),
      event('salon_click', { slug: 'antheris', pos: 5000 }),
      event('salon_click', { slug: 'antheris', pos: 1.5 }),
      event('branch_switch', {}),
      event('page_view', ['home'] as unknown as Record<string, unknown>), // x must be an object
    ];
    const parsed = parseBatch(batch([...bad, event('signup_start', {})]));
    expect(parsed?.events.map((e) => e.name)).toEqual(['signup_start']);
  });

  it('drops events with a malformed envelope of their own', () => {
    const parsed = parseBatch(
      batch([
        { ...event('page_view', { pt: 'home' }), id: 'nope' },
        { ...event('page_view', { pt: 'home' }), t: 'yesterday' },
        { ...event('page_view', { pt: 'home' }), p: '/'.repeat(513) },
        { ...event('page_view', { pt: 'home' }), ps: 's'.repeat(81) },
        'page_view',
        null,
        event('page_view', { pt: 'signup' }),
      ]),
    );
    expect(parsed?.events.map((e) => e.props)).toEqual([{ pt: 'signup' }]);
  });

  it('keeps the first of two events with the same id', () => {
    const first = event('page_view', { pt: 'home' });
    const parsed = parseBatch(batch([first, { ...first, x: { pt: 'other' } }]));
    expect(parsed?.events).toHaveLength(1);
    expect(parsed?.events[0].props).toEqual({ pt: 'home' });
  });
});

describe('parseBatch — unknown keys are stripped', () => {
  it('strips unknown props, so a form value can never be stored', () => {
    const parsed = parseEvent(
      event('booking_submit', { svc: SVC, phone: '+37491000000', name: 'Anna', email: 'a@b.am' }),
    );
    expect(parsed?.props).toEqual({ svc: SVC });
  });

  it('strips unknown keys on the event, the session context and the UTM block', () => {
    const parsed = parseBatch(
      batch([event('page_view', { pt: 'home' }, { cookie: 'x' })], {
        s: { lp: '/', utm: { source: 'ig', fbclid: 'abc' }, ua: 'Mozilla', ip: '1.2.3.4' },
        extra: true,
      }),
    );
    expect(parsed?.session).toEqual({ lp: '/', utm: { source: 'ig' } });
    expect(Object.keys(parsed!.events[0])).not.toContain('cookie');
  });

  it('treats an explicit null like an absent optional key', () => {
    const parsed = parseBatch(
      batch(
        [
          event(
            'book_click',
            { from: 'hero', svc: null },
            { ps: null, x: { from: 'hero', svc: null } },
          ),
        ],
        {
          s: { ref: null, lp: '/', utm: null, int: null },
        },
      ),
    );
    expect(parsed?.events).toHaveLength(1);
    expect(parsed?.events[0]).toMatchObject({ partnerSlug: undefined, props: { from: 'hero' } });
    expect(parsed?.session).toEqual({ lp: '/' });
    // …but null where a value is required is still invalid.
    expect(parseEvent(event('page_view', { pt: null }))).toBeNull();
  });

  it('lower-cases uuids so case cannot dodge dedupe', () => {
    const parsed = parseBatch(
      batch(
        [
          {
            ...event('specialist_open', { sp: SVC.toUpperCase() }),
            id: 'ABCDEF00-0000-4000-8000-000000000001',
          },
        ],
        {
          sid: SID.toUpperCase(),
        },
      ),
    );
    expect(parsed?.sessionId).toBe(SID);
    expect(parsed?.events[0].id).toBe('abcdef00-0000-4000-8000-000000000001');
    expect(parsed?.events[0].props).toEqual({ sp: SVC });
  });
});

describe('parseBatch — an invalid envelope drops the whole batch', () => {
  const ok = () => [event('page_view', { pt: 'home' })];

  it('accepts exactly 1..25 events', () => {
    const many = (n: number) => Array.from({ length: n }, () => event('page_view', { pt: 'home' }));
    expect(parseBatch(batch(many(MAX_BATCH_EVENTS)))?.events).toHaveLength(MAX_BATCH_EVENTS);
    expect(parseBatch(batch(many(MAX_BATCH_EVENTS + 1)))).toBeNull();
    expect(parseBatch(batch([]))).toBeNull();
  });

  it('rejects a wrong version, bad ids or a missing session context', () => {
    expect(parseBatch(batch(ok(), { v: 2 }))).toBeNull();
    expect(parseBatch(batch(ok(), { v: '1' }))).toBeNull();
    expect(parseBatch(batch(ok(), { sid: 's' }))).toBeNull();
    expect(parseBatch(batch(ok(), { vid: undefined }))).toBeNull();
    expect(parseBatch(batch(ok(), { s: undefined }))).toBeNull();
    expect(parseBatch(batch(ok(), { e: 'page_view' }))).toBeNull();
  });

  it('rejects a session context outside its limits', () => {
    expect(parseBatch(batch(ok(), { s: { ref: 'r'.repeat(1025) } }))).toBeNull();
    expect(parseBatch(batch(ok(), { s: { sw: 390.5 } }))).toBeNull();
    expect(parseBatch(batch(ok(), { s: { sh: 100_001 } }))).toBeNull();
    expect(parseBatch(batch(ok(), { s: { int: 'true' } }))).toBeNull();
    expect(parseBatch(batch(ok(), { s: { utm: { campaign: 'c'.repeat(121) } } }))).toBeNull();
    expect(parseBatch(batch(ok(), { s: { lang: 'l'.repeat(36) } }))).toBeNull();
  });

  it('rejects anything that is not a batch at all', () => {
    for (const raw of [null, undefined, 'batch', 42, [], {}]) {
      expect(parseBatch(raw)).toBeNull();
    }
  });

  it('keeps a valid envelope even when every event is dropped', () => {
    expect(parseBatch(batch([event('mouse_move', {})]))?.events).toEqual([]);
  });
});
