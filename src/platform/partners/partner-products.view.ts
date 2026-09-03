/**
 * How the internal console describes a product for one partner.
 *
 * Everything a product contributes — its usage figures and its configurable
 * settings — is declared here, in one registry per concern. The console renders
 * whatever it receives, so adding `vacancies` later means adding entries here
 * and nothing at all in the frontend.
 */

/** One usage figure shown on a product card. */
export interface ProductUsageStat {
  label: string;
  value: number;
}

/** One toggleable product setting (distinct from the entitlement itself). */
export interface ProductSetting {
  key: string;
  label: string;
  description: string;
  value: boolean;
}

/** Counts the platform query loads for a partner, used to derive usage. */
export interface PartnerCounts {
  locations: number;
  specialists: number;
  services: number;
  users: number;
  bookings: number;
  courses: number;
  courseEnrollments: number;
  vacancies: number;
}

/** The partner columns a product's settings can read. */
export interface PartnerSettingSource {
  bookingsEnabled: boolean;
  autoConfirmBookings: boolean;
}

/**
 * Usage figures per product. A product with no entry simply reports none, so an
 * unimplemented or newly seeded product degrades quietly instead of breaking
 * the page.
 */
const USAGE_RESOLVERS: Record<string, (c: PartnerCounts) => ProductUsageStat[]> = {
  bookings: (c) => [
    { label: 'Branches', value: c.locations },
    { label: 'Specialists', value: c.specialists },
    { label: 'Services', value: c.services },
    { label: 'Bookings', value: c.bookings },
  ],
  courses: (c) => [
    { label: 'Courses', value: c.courses },
    { label: 'Enrollments', value: c.courseEnrollments },
  ],
  vacancies: (c) => [
    { label: 'Listings', value: c.vacancies },
    // Branches are shown here too because a vacancies-only partner has no other
    // screen that says whether they have set their locations up at all — and a
    // partner with listings but no branches is a support ticket waiting to
    // happen (nothing can be published from a branch with no area).
    { label: 'Branches', value: c.locations },
  ],
};

/**
 * Product-specific settings, as opposed to the entitlement (which is "may they
 * use this at all") and to organization-level settings (name, slug, branding).
 *
 * NOTE these still live as columns on `partners`. They are surfaced per product
 * so the console groups them correctly; when they eventually move into
 * `PartnerProduct.settings`, only this file and the writer change.
 */
const SETTING_RESOLVERS: Record<string, (p: PartnerSettingSource) => ProductSetting[]> = {
  bookings: (p) => [
    {
      key: 'bookingsEnabled',
      label: 'Online booking',
      description: 'Off puts the salon in contact-only mode: public booking CTAs are replaced with call actions and the booking endpoints refuse.',
      value: p.bookingsEnabled,
    },
    {
      key: 'autoConfirmBookings',
      label: 'Auto-confirm bookings',
      description: 'On, public bookings are confirmed immediately instead of landing as pending for staff to accept.',
      value: p.autoConfirmBookings,
    },
  ],
};

/**
 * Which partner column each product setting writes to. This allowlist is the
 * security boundary for the generic settings endpoint — a key that is not here
 * cannot be written, so the endpoint can never be used to set arbitrary columns.
 */
export const SETTING_COLUMNS: Record<string, Record<string, keyof PartnerSettingSource>> = {
  bookings: {
    bookingsEnabled: 'bookingsEnabled',
    autoConfirmBookings: 'autoConfirmBookings',
  },
};

export function usageFor(productKey: string, counts: PartnerCounts): ProductUsageStat[] {
  return USAGE_RESOLVERS[productKey]?.(counts) ?? [];
}

export function settingsFor(productKey: string, partner: PartnerSettingSource): ProductSetting[] {
  return SETTING_RESOLVERS[productKey]?.(partner) ?? [];
}

/** A product as the console sees it: catalog + grant + usage + configuration. */
export interface PartnerProductPanel {
  key: string;
  name: string;
  description: string;
  /** Whether the partner may use it right now. */
  enabled: boolean;
  /** Grant lifecycle, or null when never granted. */
  status: string | null;
  plan: string | null;
  trialEndsAt: Date | null;
  enabledAt: Date | null;
  /** Curated products must be granted by staff and never self-serve. */
  selfServe: boolean;
  usage: ProductUsageStat[];
  settings: ProductSetting[];
}
