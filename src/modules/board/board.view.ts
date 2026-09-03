import { Prisma } from '@prisma/client';

/**
 * What the public board is allowed to see.
 *
 * Written as an explicit Prisma `select` rather than a serializer over the whole
 * row, on purpose: this is an unauthenticated endpoint, so a column added to
 * `Vacancy` later must not appear on the internet because someone spread the
 * model into a response. Adding a field here is a deliberate act.
 *
 * `reviewStatus`, `createdById`, `deletedAt` and the partner's internal flags
 * are absent by construction, not by deletion.
 */

/** The salon behind a listing, as a stranger may see it. */
const SALON_SELECT = {
  id: true,
  slug: true,
  name: true,
  nameI18n: true,
  type: true,
  typeI18n: true,
  accent: true,
  kind: true,
  presentation: { select: { logoUrl: true, whatsapp: true } },
} satisfies Prisma.PartnerSelect;

/** The place. `address` is the human street line; `area` is what filters. */
const BRANCH_SELECT = {
  id: true,
  name: true,
  nameI18n: true,
  address: true,
  phone: true,
  lat: true,
  lng: true,
  area: {
    select: {
      key: true,
      kind: true,
      name: true,
      nameI18n: true,
      parent: { select: { key: true, name: true, nameI18n: true } },
    },
  },
} satisfies Prisma.LocationSelect;

const SPECIALTY_SELECT = {
  key: true,
  groupKey: true,
  name: true,
  nameI18n: true,
  roleName: true,
  roleNameI18n: true,
} satisfies Prisma.SpecialtySelect;

/**
 * A card in the list.
 *
 * Deliberately WITHOUT the description. A description can run to 6000
 * characters, so twelve of them would be the bulk of the payload for text no
 * card has room to show — the card is designed to answer "is this worth
 * opening?" from the role, the place, the money and the terms alone.
 */
export const CARD_SELECT = {
  id: true,
  title: true,
  titleI18n: true,
  coverUrl: true,
  seats: true,

  payType: true,
  salonPercent: true,
  salonPercentMax: true,
  amount: true,
  amountMax: true,
  payPeriod: true,
  currency: true,

  scheduleType: true,
  scheduleNote: true,
  experience: true,
  perks: true,

  applyMode: true,
  publishedAt: true,

  specialty: { select: SPECIALTY_SELECT },
  partner: { select: SALON_SELECT },
  location: { select: BRANCH_SELECT },
} satisfies Prisma.VacancySelect;

/** The detail page adds the long text and the contact route. */
export const DETAIL_SELECT = {
  ...CARD_SELECT,
  description: true,
  descriptionI18n: true,
  contactPhone: true,
  expiresAt: true,
} satisfies Prisma.VacancySelect;

type CardRow = Prisma.VacancyGetPayload<{ select: typeof CARD_SELECT }>;
type DetailRow = Prisma.VacancyGetPayload<{ select: typeof DETAIL_SELECT }>;

/** Flatten the presentation join so the client never sees the join shape. */
function salonView(p: CardRow['partner']) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    nameI18n: p.nameI18n,
    type: p.type,
    typeI18n: p.typeI18n,
    accent: p.accent,
    kind: p.kind,
    logoUrl: p.presentation?.logoUrl || null,
  };
}

export function cardView(v: CardRow) {
  const { partner, location, ...rest } = v;
  return { ...rest, salon: salonView(partner), branch: location };
}

export type BoardCard = ReturnType<typeof cardView>;

/**
 * The detail view resolves the contact route server-side.
 *
 * A listing may name its own number, or inherit the branch's. The phone is
 * omitted entirely when the salon chose in-app applications only — hiding the
 * call button in the UI while still shipping the number would make the setting
 * decorative.
 */
export function detailView(v: DetailRow) {
  const { partner, location, contactPhone, ...rest } = v;
  const phoneAllowed = v.applyMode === 'phone' || v.applyMode === 'both';
  const resolved = contactPhone?.trim() || location.phone?.trim() || '';

  return {
    ...rest,
    salon: salonView(partner),
    branch: location,
    contactPhone: phoneAllowed ? resolved : '',
    whatsapp: phoneAllowed ? partner.presentation?.whatsapp || '' : '',
    /** Whether the in-app apply form should be offered at all. */
    acceptsApplications: v.applyMode === 'in_app' || v.applyMode === 'both',
  };
}

export type BoardDetail = ReturnType<typeof detailView>;
