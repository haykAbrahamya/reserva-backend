import { z } from 'zod';

/**
 * The decrypted batch (contract §2) and the event catalog (contract §3).
 *
 * Validation has two levels on purpose. An invalid ENVELOPE (version, ids,
 * session context, event count) drops the whole batch — nothing in it can be
 * trusted. An invalid EVENT drops only that event, so one bad prop from a
 * stale client build does not cost the rest of a visit. Unknown event names
 * are dropped; unknown keys anywhere are stripped (zod's default), so nothing
 * outside the catalog — a form value included — is ever stored.
 */

/** Most events one batch may carry. */
export const MAX_BATCH_EVENTS = 25;

/**
 * Drop null-valued keys before validating an object. JSON has no `undefined`,
 * so a client that writes `ps: null` means "absent"; without this the strict
 * optional fields would silently drop every such event.
 */
const withoutNulls = (value: unknown) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null))
    : value;
const nullsAbsent = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(withoutNulls, schema);

/**
 * RFC 4122 textual layout (8-4-4-4-12 hex). Any version: the format is what
 * matters for an opaque id, and a client fallback generator may not set the
 * version bits. Lower-cased so the same id cannot dodge dedupe by case.
 */
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  .transform((id) => id.toLowerCase());
const text = (max: number) => z.string().max(max);

const pageType = z.enum(['home', 'marketplace', 'partner', 'signup', 'other']);
const bookClickFrom = z.enum([
  'hero',
  'nav',
  'services',
  'team',
  'specialist',
  'locations',
  'footer',
  'courses',
  'fab',
  'other',
]);
const contactChannel = z.enum([
  'call',
  'whatsapp',
  'instagram',
  'facebook',
  'telegram',
  'directions',
  'website',
  'email',
]);
const bookingStep = z.enum(['branch', 'service', 'specialist', 'datetime', 'details', 'confirm']);
/** What was being booked — ids only, never names. */
const bookingTarget = { svc: uuid.optional(), sp: uuid.optional(), loc: uuid.optional() };

/** Props per event name. */
export const EVENT_PROPS = {
  // Everywhere
  page_view: z.object({ pt: pageType }),

  // Partner page
  book_click: z.object({ from: bookClickFrom, ...bookingTarget }),
  contact_click: z.object({ ch: contactChannel, from: text(24).optional(), loc: uuid.optional() }),
  branch_switch: z.object({ loc: uuid }),
  category_select: z.object({ cat: text(80) }),
  service_search: z.object({ q: text(60) }),
  specialist_open: z.object({ sp: uuid }),
  gallery_open: z.object({ kind: z.enum(['gallery', 'works']).optional() }),
  course_open: z.object({ course: uuid }),
  course_register_click: z.object({ course: uuid }),

  // Reviews (contract §12). Never the author or the text — the stars only.
  reviews_open: z.object({ from: z.enum(['hero', 'tab']) }),
  review_form_open: z.object({ sp: uuid }),
  review_success: z.object({ sp: uuid, stars: z.number().int().min(1).max(5) }),
  review_error: z.object({ sp: uuid.optional(), code: text(40) }),

  // Booking flow
  booking_open: z.object({ from: text(24).optional(), ...bookingTarget }),
  booking_step: z.object({ step: bookingStep }),
  booking_submit: z.object({ ...bookingTarget, any: z.boolean().optional() }),
  booking_success: z.object(bookingTarget),
  booking_error: z.object({ code: text(40) }),
  booking_close: z.object({ step: text(24) }),

  // Sign-up page
  signup_start: z.object({}),
  signup_step: z.object({ step: text(24) }),
  signup_submit: z.object({}),
  signup_error: z.object({ field: text(40).optional(), code: text(40).optional() }),
  signup_success: z.object({}),

  // Marketplace
  salons_search: z.object({ q: text(60) }),
  salons_filter: z.object({ cat: text(80).optional(), area: text(80).optional() }),
  salon_click: z.object({ slug: text(80), pos: z.number().int().min(0).max(1000).optional() }),
} satisfies Record<string, z.AnyZodObject>;

export type SiteEventName = keyof typeof EVENT_PROPS;
export const SITE_EVENT_NAMES = Object.keys(EVENT_PROPS) as [SiteEventName, ...SiteEventName[]];

/** Captured by the client at session start and repeated on every batch. */
const sessionContextSchema = z.object({
  ref: text(1024).optional(),
  lp: text(512).optional(),
  lh: text(255).optional(),
  utm: nullsAbsent(
    z.object({
      source: text(120).optional(),
      medium: text(120).optional(),
      campaign: text(120).optional(),
      content: text(120).optional(),
      term: text(120).optional(),
    }),
  ).optional(),
  lang: text(35).optional(),
  sw: z.number().int().min(0).max(100_000).optional(),
  sh: z.number().int().min(0).max(100_000).optional(),
  /** Staff / internal traffic (contract §6). */
  int: z.boolean().optional(),
});
export type SessionContext = z.infer<typeof sessionContextSchema>;

const envelopeSchema = z.object({
  v: z.literal(1),
  sid: uuid,
  vid: uuid,
  s: nullsAbsent(sessionContextSchema),
  // Events are validated one by one below, so a bad one costs only itself.
  e: z.array(z.unknown()).min(1).max(MAX_BATCH_EVENTS),
});

const eventSchema = nullsAbsent(
  z.object({
    id: uuid,
    n: z.enum(SITE_EVENT_NAMES),
    /** Client epoch ms — ordering only; the server keeps its own time. */
    t: z.number().finite().optional(),
    p: text(512).optional(),
    h: text(255).optional(),
    ps: text(80).optional(),
    x: z.record(z.unknown()).optional(),
  }),
);

export interface PulseEvent {
  id: string;
  name: SiteEventName;
  clientTime: number | undefined;
  path: string | undefined;
  host: string | undefined;
  partnerSlug: string | undefined;
  /** Validated props: catalogued keys only. */
  props: Record<string, unknown>;
}

export interface PulseBatch {
  sessionId: string;
  visitorId: string;
  session: SessionContext;
  /** Valid events, first occurrence of each id. May be empty. */
  events: PulseEvent[];
}

/** One event, or null when it is malformed, unknown or carries invalid props. */
export function parseEvent(raw: unknown): PulseEvent | null {
  const event = eventSchema.safeParse(raw);
  if (!event.success) return null;
  const props = EVENT_PROPS[event.data.n].safeParse(withoutNulls(event.data.x ?? {}));
  if (!props.success) return null;
  return {
    id: event.data.id,
    name: event.data.n,
    clientTime: event.data.t,
    path: event.data.p,
    host: event.data.h,
    partnerSlug: event.data.ps,
    props: props.data,
  };
}

/** A decrypted payload → a batch, or null when the envelope is invalid. */
export function parseBatch(raw: unknown): PulseBatch | null {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) return null;

  const events: PulseEvent[] = [];
  const seen = new Set<string>();
  for (const item of envelope.data.e) {
    const event = parseEvent(item);
    if (!event || seen.has(event.id)) continue;
    seen.add(event.id);
    events.push(event);
  }
  return {
    sessionId: envelope.data.sid,
    visitorId: envelope.data.vid,
    session: envelope.data.s,
    events,
  };
}
