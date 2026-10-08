/**
 * Response shapes of GET /platform/analytics/* (contract §5). The console's
 * Analytics section is built against exactly these — change them only with the
 * contract. Every response is wrapped `{ data }` by the TransformInterceptor.
 */

export interface Kpi {
  value: number;
  /** The same number for the equally long period right before `from`. */
  prev: number;
}

export interface Range {
  from: string;
  to: string;
  days: number;
}

export interface AnalyticsOverview {
  range: Range;
  kpis: {
    /** Distinct visitorId with ≥1 event in range. */
    visitors: Kpi;
    /** Distinct sessionId with ≥1 event in range. */
    sessions: Kpi;
    pageViews: Kpi;
    /** page_view events attributed to a partner. */
    partnerViews: Kpi;
    bookClicks: Kpi;
    bookingOpens: Kpi;
    /** Truth from the bookings table: source = 'public', created in range. */
    bookings: Kpi;
    contactClicks: Kpi;
    /** page_view with props.pt = 'signup'. */
    signupViews: Kpi;
    signupStarts: Kpi;
    /** pending_registrations created in range. */
    signups: Kpi;
    /** pending_registrations consumed (activated) in range. */
    activations: Kpi;
    /** review_form_open — the "Write a review" form opened. */
    reviewForms: Kpi;
    /** specialist_reviews created in range — only the public site writes them. */
    reviews: Kpi;
  };
  /** Every day in range, zeros filled, ascending. */
  series: {
    date: string;
    visitors: number;
    sessions: number;
    pageViews: number;
    bookings: number;
  }[];
  /** contact_click by props.ch, most first. */
  contacts: { channel: string; count: number }[];
  /** Top 5 partners by views. */
  topPartners: PartnerRow[];
}

export interface PartnerContacts {
  call: number;
  whatsapp: number;
  instagram: number;
  directions: number;
  other: number;
}

export interface PartnerRow {
  partnerId: string;
  name: string;
  slug: string | null;
  /** page_view events on this partner. */
  views: number;
  /** Distinct visitorId with any event on this partner. */
  visitors: number;
  bookClicks: number;
  bookingOpens: number;
  /** Public bookings created in range for this partner (bookings table). */
  bookings: number;
  /**
   * Of the sessions with a page_view on this partner, the share that also had
   * a booking_success there (0..1, contract §9) — tracked events on both
   * sides, never `bookings` over visitors. Null when no session viewed it.
   */
  conversion: number | null;
  contacts: PartnerContacts;
}

export interface AnalyticsPartners {
  range: Range;
  /** Partners with any event OR public booking in range, most views first. */
  rows: PartnerRow[];
  /**
   * `visitors` and `conversion` are computed over distinct visitors / sessions
   * across all partners, not summed from the rows.
   */
  totals: Omit<PartnerRow, 'partnerId' | 'name' | 'slug'>;
}

export interface AnalyticsSources {
  range: Range;
  channels: { channel: string; sessions: number; visitors: number }[];
  /** Top 20, empty referrers excluded. */
  referrers: { host: string; sessions: number }[];
  /** Top 20 sessions that carried UTM tags. */
  campaigns: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    sessions: number;
  }[];
  devices: { deviceType: string; sessions: number }[];
  /** Top 15; null → 'unknown'. */
  countries: { country: string; sessions: number }[];
  /** Top 10 primary language subtags, lower-case ('hy', 'ru', 'en'). */
  languages: { language: string; sessions: number }[];
}

/**
 * GET /platform/analytics/bounds (contract §8): Yerevan days of the earliest
 * and latest recorded event — bots excluded, internal included, since it only
 * bounds the console's date picker. Both null when nothing is recorded yet.
 */
export interface AnalyticsBounds {
  first: string | null;
  last: string | null;
}

/** GET /platform/analytics/storage (contract §10). */
export interface AnalyticsStorage {
  events: number;
  sessions: number;
  /** pg_total_relation_size of both tables (data + indexes + TOAST). */
  bytes: number;
  /** Yerevan day of the oldest stored event; null when there are none. */
  oldest: string | null;
}

/** DELETE /platform/analytics/data (contract §10): rows deleted. */
export interface AnalyticsCleared {
  events: number;
  sessions: number;
}

export interface AnalyticsEventRow {
  id: string;
  name: string;
  /** ISO. */
  createdAt: string;
  path: string | null;
  host: string | null;
  props: Record<string, unknown>;
  partner: { id: string; name: string; slug: string | null } | null;
  session: {
    id: string;
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
  };
}

// ── Sessions — the "person view" (contract §11) ──────────────────────────────
// Anonymous by design: a person is the random visitorId, never a name or phone.

export interface PartnerRef {
  id: string;
  name: string;
  slug: string | null;
}

/** One visit, summarised. Times are server times of its first and last event. */
export interface SessionRow {
  id: string;
  visitorId: string;
  /** ISO — first event. */
  startedAt: string;
  /** ISO — last event. */
  lastSeenAt: string;
  /** Last − first event, ≥ 0. */
  durationSec: number;
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
  eventCount: number;
  pageViews: number;
  /** Partners touched, in first-seen order, at most 5. */
  partners: PartnerRef[];
  /**
   * booked = booking_success · contacted = contact_click · signedUp =
   * signup_success · reviewed = review_success · bookClicked = book_click or
   * booking_open.
   */
  outcome: {
    booked: boolean;
    contacted: boolean;
    signedUp: boolean;
    reviewed: boolean;
    bookClicked: boolean;
  };
  /** The first ≤ 12 event names, in order (preview chips). */
  journey: string[];
  /** Sessions of this visitorId, all time, bots excluded — the "returning" hint. */
  visitorSessions: number;
}

export interface SessionEvent {
  id: string;
  name: string;
  /** ISO, server time. */
  at: string;
  /** ISO, the client's clock. */
  clientAt: string | null;
  path: string | null;
  host: string | null;
  partner: PartnerRef | null;
  props: Record<string, unknown>;
}

/** GET /platform/analytics/sessions/:id */
export interface SessionDetail {
  session: SessionRow;
  /** Every event, chronological by (clientAt ?? createdAt), then createdAt. */
  events: SessionEvent[];
  /** uuid → name for every svc / sp / loc / course id in the events' props. */
  labels: Record<string, string>;
  /** The same visitor's other sessions, newest first, at most 20. */
  otherSessions: {
    id: string;
    startedAt: string;
    channel: string;
    eventCount: number;
    booked: boolean;
  }[];
}
