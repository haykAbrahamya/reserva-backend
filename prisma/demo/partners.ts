/**
 * The demo tenants, declared as data.
 *
 * Each one exists to make a specific part of the product reachable without
 * hand-building it first — the `purpose` line says which. Between them they
 * cover both partner kinds, every product, every product-grant state, both
 * public page templates, contact-only mode, a deactivated tenant, partners with
 * and without a slug, and areas inside and outside Yerevan.
 *
 * Content follows the app's own rules: base values are English and hy/ru live
 * in the *I18n override blobs (exactly what the backoffice translation fields
 * write), phones are stored the way `normalizePhone` stores them, and a solo
 * partner gets the one location + specialist that SignupService provisions.
 */
import type { InteriorMotif, WorkMotif } from './images';
import type { Weekday } from './random';

export type L10n = { hy?: string; en?: string; ru?: string };
export type DaySchedule = { enabled: boolean; start: string; end: string };
export type Week = Record<Weekday, DaySchedule>;

const ALL_DAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MON_SAT: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** A full week from the open days; anything not listed is closed. */
export function week(open: Partial<Record<Weekday, [string, string]>>): Week {
  return Object.fromEntries(
    ALL_DAYS.map((d) => {
      const w = open[d];
      return [d, w ? { enabled: true, start: w[0], end: w[1] } : { enabled: false, start: '10:00', end: '19:00' }];
    }),
  ) as Week;
}

/** The same hours on each of `days`. */
export function daily(start: string, end: string, days: Weekday[] = MON_SAT): Week {
  return week(Object.fromEntries(days.map((d) => [d, [start, end]])) as Partial<Record<Weekday, [string, string]>>);
}

/** What SignupService / PlatformPartnersService give a new solo pro (Mon–Sat 10–19). */
export const SOLO_DEFAULT = daily('10:00', '19:00');

// ── Spec types ────────────────────────────────────────────────

export type ProductKey = 'bookings' | 'courses' | 'vacancies';

export interface DemoProduct {
  key: ProductKey;
  status?: 'active' | 'trialing' | 'suspended';
  /** trialing: days left on the trial. */
  trialDays?: number;
  /** suspended: how long ago access was withdrawn. */
  suspendedDaysAgo?: number;
  /** Curated grant made by platform staff (audit trail points at the owner). */
  byStaff?: boolean;
}

export interface DemoLocation {
  key: string;
  name: string;
  nameI18n?: L10n;
  address: string;
  phone: string;
  areaKey: string | null;
  lat?: number;
  lng?: number;
  /** null = never set (stored as {}), which availability treats as "no limit". */
  hours: Week | null;
}

export interface DemoService {
  key: string;
  name: string;
  nameI18n?: L10n;
  category: string;
  categoryI18n?: L10n;
  price: number;
  /** Present → a range-priced service (`price` is the lower bound). */
  priceMax?: number;
  /** Only needed for an open-ended "from X": 'range' with no `priceMax`. */
  priceType?: 'fixed' | 'range';
  hidePrice?: boolean;
  duration: number;
  repeatEveryDays?: number;
  /** Facility/entry service: no specialist, `capacity` guests per slot. */
  capacity?: number;
  active?: boolean;
}

export interface DemoTimeOff {
  /** Day offset from today. */
  day: number;
  /** Whole days (all-day off). Ignored when from/to are given. */
  days?: number;
  from?: string;
  to?: string;
  reason: string;
}

export interface DemoSpecialist {
  key: string;
  name: string;
  nameI18n?: L10n;
  title: string;
  titleI18n?: L10n;
  location: string;
  phone: string;
  schedule: Week;
  services: string[] | 'all';
  active?: boolean;
  /** Generate an illustrated portrait; false leaves the initials fallback. */
  avatar?: boolean;
  reviews?: number;
  timeOff?: DemoTimeOff[];
  /** More branches this specialist works at (besides `location`), each with its own hours. */
  alsoAt?: { location: string; schedule: Week }[];
}

/** A branch's own setting for a service (location_services). */
export interface DemoBranchPrice {
  location: string;
  service: string;
  offered?: boolean;
  price?: number;
  priceMax?: number;
  /** 'range' with no `priceMax` = an open-ended "from X". */
  priceType?: 'fixed' | 'range';
  duration?: number;
  capacity?: number;
}

/** One specialist's own price / duration for a service at a branch (specialist_prices). */
export interface DemoSpecialistPrice {
  specialist: string;
  location: string;
  service: string;
  price?: number;
  priceMax?: number;
  priceType?: 'fixed' | 'range';
  duration?: number;
}

export interface DemoUser {
  name: string;
  email: string;
  phone: string;
  role: 'admin' | 'manager';
  location?: string;
  /** Hours since the last backoffice visit; null = never signed in. */
  lastSeenHoursAgo: number | null;
  mustChangePassword?: boolean;
}

export interface DemoBookingPlan {
  /** Inclusive day offsets from today. */
  fromDay: number;
  toDay: number;
  /** Appointments per active specialist per working day. */
  perDay: [number, number];
  /** Facility-service visits per location per day. */
  facilityPerDay?: [number, number];
  /** Share booked by customers online; the rest are staff-entered. */
  publicShare: number;
  /** Size of the customer base. */
  clients: number;
}

export interface DemoMember {
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'noshow';
  source: 'public' | 'backoffice';
  /** Days ago the member registered / was added. */
  daysAgo: number;
}

export interface DemoRun {
  status: 'draft' | 'open' | 'running' | 'completed' | 'archived';
  location?: string;
  /** Start relative to today; null = undated (rolling). */
  startInDays: number | null;
  lengthDays?: number;
  scheduleText: string;
  capacity: number;
  registrationOpen: boolean;
  members: DemoMember[];
}

export interface DemoCourse {
  title: string;
  titleI18n?: L10n;
  summary: string;
  summaryI18n?: L10n;
  description: string;
  descriptionI18n?: L10n;
  priceMode: 'hidden' | 'free' | 'paid';
  price?: number;
  level: 'beginner' | 'intermediate' | 'advanced' | null;
  tutor: { specialist: string } | { name: string; title: string } | null;
  active: boolean;
  cover: WorkMotif | null;
  createdDaysAgo: number;
  current: DemoRun;
  /** Earlier runs, archived — they show under the course's History. */
  history?: DemoRun[];
}

export interface DemoVacancy {
  specialtyKey: string;
  location: string;
  title?: string;
  titleI18n?: L10n;
  description: string;
  descriptionI18n?: L10n;
  seats?: number;
  payType: 'percentage' | 'rent' | 'salary' | 'negotiable';
  salonPercent?: number;
  salonPercentMax?: number;
  amount?: number;
  amountMax?: number;
  payPeriod?: 'day' | 'week' | 'month';
  scheduleType?: 'full_time' | 'part_time' | 'shift' | 'flexible';
  scheduleNote?: string;
  experience: 'any' | 'junior' | 'experienced';
  perks: string[];
  applyMode: 'in_app' | 'phone' | 'both';
  contactPhone?: string;
  /** `expired` = published, but its 30-day clock has run out. */
  state: 'draft' | 'published' | 'paused' | 'closed' | 'expired';
  publishedDaysAgo?: number;
  cover?: WorkMotif;
  applicants: number;
}

export interface DemoSupport {
  status: 'open' | 'closed';
  messages: { from: 'partner' | 'platform'; text: string; minutesAgo: number; read: boolean }[];
}

export interface DemoPresentation {
  tagline?: string;
  taglineI18n?: L10n;
  about?: string;
  aboutI18n?: L10n;
  hours?: string;
  instagram?: string;
  facebook?: string;
  whatsapp?: string;
  heroTints?: string[];
  logo?: { text: string; style: 'serif' | 'sans' | 'italic' };
  gallery?: { label: string; motif: InteriorMotif }[];
  works?: { label: string; motif: WorkMotif; beforeAfter?: boolean }[];
}

export interface DemoPartner {
  /** What this tenant demonstrates — printed in the seed report. */
  purpose: string;
  slug: string | null;
  name: string;
  nameI18n?: L10n;
  type: string;
  typeI18n?: L10n;
  kind: 'salon' | 'single';
  template?: 'classic' | 'tabbed';
  supportWidget?: 'support' | 'book' | 'hidden';
  defaultLocale?: 'hy' | 'en' | 'ru';
  accent: string;
  autoConfirmBookings?: boolean;
  bookingsEnabled?: boolean;
  marketplaceListed?: boolean;
  active?: boolean;
  createdDaysAgo: number;
  products: DemoProduct[];
  presentation: DemoPresentation;
  locations: DemoLocation[];
  services?: DemoService[];
  specialists?: DemoSpecialist[];
  users: DemoUser[];
  bookings?: DemoBookingPlan;
  courses?: DemoCourse[];
  vacancies?: DemoVacancy[];
  support?: DemoSupport;
  /** Switch on branch & specialist pricing for this partner (bookings grant setting). */
  branchPricing?: boolean;
  branchPrices?: DemoBranchPrice[];
  specialistPrices?: DemoSpecialistPrice[];
}

// Shared translated category labels.
const CAT = {
  laser: { hy: 'Լազեր', ru: 'Лазер' },
  facial: { hy: 'Դեմքի խնամք', ru: 'Уход за лицом' },
  injections: { hy: 'Ներարկումներ', ru: 'Инъекции' },
  consult: { hy: 'Խորհրդատվություններ', ru: 'Консультации' },
  wellness: { hy: 'Վելնես', ru: 'Велнес' },
  hair: { hy: 'Մազեր', ru: 'Волосы' },
  beard: { hy: 'Մորուք', ru: 'Борода' },
  combo: { hy: 'Կոմբո', ru: 'Комбо' },
  nails: { hy: 'Եղունգներ', ru: 'Ногти' },
  lashes: { hy: 'Թարթիչներ', ru: 'Ресницы' },
  brows: { hy: 'Հոնքեր', ru: 'Брови' },
  massage: { hy: 'Մերսում', ru: 'Массаж' },
  therapy: { hy: 'Թերապիա', ru: 'Терапия' },
  body: { hy: 'Մարմին', ru: 'Тело' },
  spaZone: { hy: 'Սպա գոտի', ru: 'Спа-зона' },
  manicure: { hy: 'Մատնահարդարում', ru: 'Маникюр' },
  pedicure: { hy: 'Ոտնահարդարում', ru: 'Педикюр' },
  extras: { hy: 'Լրացուցիչ', ru: 'Дополнительно' },
  cuts: { hy: 'Սանրվածքներ', ru: 'Стрижки' },
  styling: { hy: 'Հարդարում', ru: 'Укладка' },
  colour: { hy: 'Ներկում', ru: 'Окрашивание' },
  care: { hy: 'Խնամք', ru: 'Уход' },
} satisfies Record<string, L10n>;

// ══════════════════════════════════════════════════════════════
export const PARTNERS: DemoPartner[] = [
  // ── 1. Antheris — the full salon ────────────────────────────
  {
    purpose: 'FULL SALON — all 3 products, 2 branches, 2 branch managers, translated catalog, every booking/course/vacancy state',
    slug: 'antheris',
    name: 'Antheris',
    nameI18n: { hy: 'Անթերիս', ru: 'Антерис' },
    type: 'Aesthetic clinic',
    typeI18n: { hy: 'Էսթետիկ բժշկության կլինիկա', ru: 'Клиника эстетической медицины' },
    kind: 'salon',
    template: 'classic',
    supportWidget: 'support',
    defaultLocale: 'hy',
    accent: '#E8456B',
    autoConfirmBookings: false,
    marketplaceListed: true,
    createdDaysAgo: 160,
    products: [{ key: 'bookings' }, { key: 'courses', byStaff: true }, { key: 'vacancies' }],
    presentation: {
      tagline: 'Modern aesthetic medicine in the heart of Yerevan',
      taglineI18n: {
        hy: 'Ժամանակակից էսթետիկ բժշկություն Երևանի սրտում',
        ru: 'Современная эстетическая медицина в самом сердце Еревана',
      },
      about:
        'Antheris is a clinical aesthetics studio where science meets care. From laser treatments to bespoke facials, our specialists craft results-driven plans tailored to your skin — in a calm, considered space designed to make you feel at home.',
      aboutI18n: {
        hy: 'Անթերիսը կլինիկական էսթետիկայի ստուդիա է, որտեղ գիտությունը հանդիպում է հոգատարությանը։ Լազերային պրոցեդուրաներից մինչև անհատական դեմքի խնամք՝ մեր մասնագետները կազմում են արդյունքի վրա հիմնված ծրագրեր՝ հարմարեցված հենց ձեր մաշկին, հանգիստ միջավայրում, որտեղ դուք ձեզ կզգաք ինչպես տանը։',
        ru: 'Антерис — студия клинической эстетики, где наука встречается с заботой. От лазерных процедур до индивидуального ухода за лицом — наши специалисты составляют программы, нацеленные на результат и подобранные именно под вашу кожу, в спокойном пространстве, где вы почувствуете себя как дома.',
      },
      hours: 'Mon–Sat · 10:00–19:00',
      instagram: 'https://instagram.com/reserva.am',
      facebook: 'https://facebook.com/reserva.am',
      whatsapp: '37491101010',
      heroTints: ['#2C2C30', '#121214'],
      logo: { text: 'A', style: 'serif' },
      gallery: [
        { label: 'Reception', motif: 'reception' },
        { label: 'Treatment room', motif: 'room' },
        { label: 'Laser suite', motif: 'mirror' },
        { label: 'Lounge', motif: 'lounge' },
        { label: 'Entrance', motif: 'facade' },
        { label: 'Details', motif: 'detail' },
      ],
      works: [
        { label: 'Acne scar treatment — 3 sessions', motif: 'skin', beforeAfter: true },
        { label: 'Hydrafacial glow', motif: 'skin' },
        { label: 'Lash lift & tint', motif: 'lashes', beforeAfter: true },
        { label: 'Laser rejuvenation', motif: 'skin' },
      ],
    },
    locations: [
      {
        key: 'arabkir',
        name: 'Arabkir',
        nameI18n: { hy: 'Արաբկիր', ru: 'Арабкир' },
        address: '34 Komitas Ave, Yerevan',
        phone: '+374 10 24 56 78',
        areaKey: 'yerevan-arabkir',
        lat: 40.2047,
        lng: 44.5021,
        hours: week({
          mon: ['10:00', '19:00'], tue: ['10:00', '19:00'], wed: ['10:00', '19:00'], thu: ['10:00', '19:00'],
          fri: ['10:00', '19:00'], sat: ['10:00', '19:00'], sun: ['11:00', '17:00'],
        }),
      },
      {
        key: 'kentron',
        name: 'Kentron',
        nameI18n: { hy: 'Կենտրոն', ru: 'Кентрон' },
        address: '12 Pushkin St, Yerevan',
        phone: '+374 10 53 11 02',
        areaKey: 'yerevan-kentron',
        lat: 40.1826,
        lng: 44.5108,
        hours: daily('10:00', '18:00'),
      },
    ],
    services: [
      { key: 'consult', name: 'Dermatology consultation', nameI18n: { hy: 'Մաշկաբանի խորհրդատվություն', ru: 'Консультация дерматолога' }, category: 'Consultations', categoryI18n: CAT.consult, price: 15000, duration: 45 },
      { key: 'laser-face', name: 'Laser hair removal — full face', nameI18n: { hy: 'Լազերային էպիլյացիա — ամբողջ դեմք', ru: 'Лазерная эпиляция — всё лицо' }, category: 'Laser', categoryI18n: CAT.laser, price: 18000, duration: 30, repeatEveryDays: 30 },
      { key: 'laser-legs', name: 'Laser hair removal — full legs', nameI18n: { hy: 'Լազերային էպիլյացիա — ոտքեր ամբողջությամբ', ru: 'Лазерная эпиляция — ноги полностью' }, category: 'Laser', categoryI18n: CAT.laser, price: 35000, duration: 60, repeatEveryDays: 42 },
      { key: 'laser-bikini', name: 'Laser hair removal — bikini', nameI18n: { hy: 'Լազերային էպիլյացիա — բիկինի գոտի', ru: 'Лазерная эпиляция — зона бикини' }, category: 'Laser', categoryI18n: CAT.laser, price: 22000, duration: 30, repeatEveryDays: 35 },
      { key: 'hydrafacial', name: 'Hydrafacial deep cleanse', nameI18n: { hy: 'Հիդրաֆեյշլ՝ դեմքի խորը մաքրում', ru: 'Гидрафейшл — глубокое очищение' }, category: 'Facial care', categoryI18n: CAT.facial, price: 28000, duration: 75, repeatEveryDays: 28 },
      { key: 'peel', name: 'Chemical peel', nameI18n: { hy: 'Քիմիական պիլինգ', ru: 'Химический пилинг' }, category: 'Facial care', categoryI18n: CAT.facial, price: 20000, priceMax: 45000, duration: 45, repeatEveryDays: 21 },
      { key: 'mesotherapy', name: 'Mesotherapy', nameI18n: { hy: 'Մեզոթերապիա', ru: 'Мезотерапия' }, category: 'Injections', categoryI18n: CAT.injections, price: 30000, duration: 40, repeatEveryDays: 14 },
      { key: 'botox', name: 'Botox — one zone', nameI18n: { hy: 'Բոտոքս — մեկ գոտի', ru: 'Ботокс — одна зона' }, category: 'Injections', categoryI18n: CAT.injections, price: 55000, duration: 30, hidePrice: true, repeatEveryDays: 120 },
      { key: 'filler', name: 'Lip filler', nameI18n: { hy: 'Շուրթերի ֆիլեր', ru: 'Филлер для губ' }, category: 'Injections', categoryI18n: CAT.injections, price: 80000, priceMax: 150000, duration: 45 },
      { key: 'led', name: 'LED light therapy capsule', nameI18n: { hy: 'LED լուսաթերապիայի խցիկ', ru: 'Капсула LED-светотерапии' }, category: 'Wellness', categoryI18n: CAT.wellness, price: 9000, duration: 30, capacity: 2 },
      { key: 'microneedling', name: 'Microneedling', nameI18n: { hy: 'Միկրոնիդլինգ', ru: 'Микронидлинг' }, category: 'Facial care', categoryI18n: CAT.facial, price: 32000, duration: 60, active: false },
    ],
    specialists: [
      {
        key: 'anush', name: 'Anush Petrosyan', nameI18n: { hy: 'Անուշ Պետրոսյան', ru: 'Ануш Петросян' },
        title: 'Lead aesthetician', titleI18n: { hy: 'Գլխավոր էսթետիստ', ru: 'Ведущий эстетист' },
        location: 'arabkir', phone: '+37491221133',
        schedule: week({ mon: ['10:00', '19:00'], tue: ['10:00', '19:00'], wed: ['10:00', '19:00'], thu: ['10:00', '19:00'], fri: ['10:00', '19:00'], sat: ['10:00', '16:00'] }),
        services: ['hydrafacial', 'peel', 'mesotherapy', 'laser-face'], avatar: true, reviews: 14,
        timeOff: [{ day: 9, days: 3, reason: 'Vacation' }],
      },
      {
        key: 'mariam', name: 'Mariam Sargsyan', nameI18n: { hy: 'Մարիամ Սարգսյան', ru: 'Мариам Саргсян' },
        title: 'Laser specialist', titleI18n: { hy: 'Լազերային թերապիայի մասնագետ', ru: 'Специалист по лазерным процедурам' },
        location: 'arabkir', phone: '+37491881244',
        schedule: week({ tue: ['11:00', '19:00'], wed: ['11:00', '19:00'], thu: ['11:00', '19:00'], fri: ['11:00', '19:00'], sat: ['11:00', '19:00'], sun: ['11:00', '17:00'] }),
        services: ['laser-face', 'laser-legs', 'laser-bikini'], avatar: true, reviews: 11,
      },
      {
        key: 'lilit', name: 'Dr. Lilit Hovhannisyan', nameI18n: { hy: 'Բժ. Լիլիթ Հովհաննիսյան', ru: 'Д-р Лилит Ованнисян' },
        title: 'Dermatologist', titleI18n: { hy: 'Մաշկաբան', ru: 'Дерматолог' },
        location: 'kentron', phone: '+37491098821',
        schedule: daily('10:00', '18:00'),
        services: ['consult', 'botox', 'filler', 'mesotherapy'], avatar: true, reviews: 9,
        timeOff: [{ day: 2, from: '13:00', to: '15:00', reason: 'Medical conference' }],
      },
      {
        key: 'sona', name: 'Sona Mkrtchyan', nameI18n: { hy: 'Սոնա Մկրտչյան', ru: 'Сона Мкртчян' },
        title: 'Cosmetologist', titleI18n: { hy: 'Կոսմետոլոգ', ru: 'Косметолог' },
        location: 'kentron', phone: '+37491447755',
        schedule: week({ mon: ['10:00', '18:00'], tue: ['10:00', '18:00'], thu: ['10:00', '18:00'], fri: ['10:00', '18:00'], sat: ['10:00', '18:00'] }),
        services: ['hydrafacial', 'peel', 'laser-bikini', 'mesotherapy'], avatar: false, reviews: 6,
      },
      {
        key: 'nare', name: 'Nare Avetisyan', nameI18n: { hy: 'Նարե Ավետիսյան', ru: 'Нарэ Аветисян' },
        title: 'Aesthetician', titleI18n: { hy: 'Էսթետիստ', ru: 'Эстетист' },
        location: 'kentron', phone: '+37491338719',
        schedule: daily('10:00', '18:00'),
        services: ['hydrafacial'], active: false, avatar: false, reviews: 3,
      },
    ],
    users: [
      { name: 'Armen Petrosyan', email: 'admin@antheris.am', phone: '+37491101010', role: 'admin', lastSeenHoursAgo: 1 },
      { name: 'Karine Hakobyan', email: 'manager@antheris.am', phone: '+37491202020', role: 'manager', location: 'arabkir', lastSeenHoursAgo: 5 },
      { name: 'Ruzanna Galstyan', email: 'kentron@antheris.am', phone: '+37491303030', role: 'manager', location: 'kentron', lastSeenHoursAgo: 30 },
      { name: 'Hovik Asatryan', email: 'reception@antheris.am', phone: '+37491404040', role: 'manager', location: 'kentron', lastSeenHoursAgo: null, mustChangePassword: true },
    ],
    bookings: { fromDay: -28, toDay: 14, perDay: [2, 4], facilityPerDay: [0, 3], publicShare: 0.6, clients: 36 },
    courses: [
      {
        title: 'Laser hair removal technician',
        titleI18n: { hy: 'Լազերային էպիլյացիայի մասնագետ', ru: 'Специалист по лазерной эпиляции' },
        summary: 'Six weeks of theory and supervised practice on professional diode lasers.',
        summaryI18n: {
          hy: 'Վեց շաբաթ տեսություն և պրակտիկա պրոֆեսիոնալ դիոդային լազերներով՝ վարպետի հսկողությամբ։',
          ru: 'Шесть недель теории и практики на профессиональных диодных лазерах под контролем наставника.',
        },
        description:
          'What you will learn:\n• Skin and hair physiology, Fitzpatrick phototypes\n• Laser safety, contraindications and client consultation\n• Choosing parameters for every body zone\n• Supervised practice on real clients from week three\n\nGraduates receive a certificate, and the best are invited to join our team.',
        descriptionI18n: {
          hy: 'Ինչ կսովորեք՝\n• Մաշկի և մազի ֆիզիոլոգիա, Ֆիցպատրիկի ֆոտոտիպեր\n• Լազերային անվտանգություն, հակացուցումներ և հաճախորդի խորհրդատվություն\n• Պարամետրերի ընտրություն մարմնի յուրաքանչյուր գոտու համար\n• Պրակտիկա իրական հաճախորդների հետ՝ երրորդ շաբաթից\n\nՇրջանավարտները ստանում են վկայական, իսկ լավագույններին հրավիրում ենք մեր թիմ։',
          ru: 'Чему вы научитесь:\n• Физиология кожи и волос, фототипы по Фицпатрику\n• Лазерная безопасность, противопоказания и консультация клиента\n• Подбор параметров для каждой зоны\n• Практика на реальных клиентах с третьей недели\n\nВыпускники получают сертификат, а лучших мы приглашаем в команду.',
        },
        priceMode: 'paid',
        price: 250000,
        level: 'intermediate',
        tutor: { specialist: 'mariam' },
        active: true,
        cover: 'skin',
        createdDaysAgo: 120,
        current: {
          status: 'open', location: 'arabkir', startInDays: 12, lengthDays: 42,
          scheduleText: 'Mon & Wed · 18:00–20:30', capacity: 8, registrationOpen: true,
          members: [
            { status: 'confirmed', source: 'backoffice', daysAgo: 9 },
            { status: 'confirmed', source: 'public', daysAgo: 6 },
            { status: 'confirmed', source: 'public', daysAgo: 4 },
            { status: 'cancelled', source: 'public', daysAgo: 5 },
            { status: 'pending', source: 'public', daysAgo: 1 },
            { status: 'pending', source: 'public', daysAgo: 0 },
          ],
        },
        history: [
          {
            status: 'archived', location: 'arabkir', startInDays: -100, lengthDays: 42,
            scheduleText: 'Mon & Wed · 18:00–20:30', capacity: 8, registrationOpen: false,
            members: [
              { status: 'completed', source: 'public', daysAgo: 112 },
              { status: 'completed', source: 'public', daysAgo: 110 },
              { status: 'completed', source: 'backoffice', daysAgo: 109 },
              { status: 'completed', source: 'public', daysAgo: 106 },
              { status: 'completed', source: 'public', daysAgo: 104 },
              { status: 'noshow', source: 'public', daysAgo: 103 },
            ],
          },
        ],
      },
      {
        title: 'Skincare basics for beginners',
        titleI18n: { hy: 'Մաշկի խնամքի հիմունքներ սկսնակների համար', ru: 'Основы ухода за кожей для начинающих' },
        summary: 'A free Saturday workshop: build a routine that actually suits your skin.',
        summaryI18n: {
          hy: 'Անվճար շաբաթօրյա սեմինար՝ կազմեք խնամքի ռեժիմ, որն իսկապես համապատասխանում է ձեր մաշկին։',
          ru: 'Бесплатный субботний воркшоп: соберите уход, который действительно подходит вашей коже.',
        },
        description:
          'Two-hour sessions on cleansing, SPF, actives and the most common skincare mistakes. Bring your products — we will review them together.',
        descriptionI18n: {
          hy: 'Երկժամյա հանդիպումներ մաքրման, SPF-ի, ակտիվ բաղադրիչների և ամենատարածված սխալների մասին։ Բերեք ձեր միջոցները՝ միասին կքննարկենք։',
          ru: 'Двухчасовые занятия об очищении, SPF, активных компонентах и самых частых ошибках в уходе. Приносите свои средства — разберём их вместе.',
        },
        priceMode: 'free',
        level: 'beginner',
        tutor: { name: 'Dr. Ani Mirzoyan', title: 'Cosmetologist, guest lecturer' },
        active: true,
        cover: 'spa',
        createdDaysAgo: 40,
        current: {
          status: 'running', location: 'kentron', startInDays: -5, lengthDays: 14,
          scheduleText: 'Sat · 12:00–14:00', capacity: 20, registrationOpen: false,
          members: [
            { status: 'confirmed', source: 'public', daysAgo: 20 },
            { status: 'confirmed', source: 'public', daysAgo: 18 },
            { status: 'confirmed', source: 'backoffice', daysAgo: 17 },
            { status: 'confirmed', source: 'public', daysAgo: 15 },
            { status: 'confirmed', source: 'public', daysAgo: 12 },
            { status: 'confirmed', source: 'public', daysAgo: 10 },
            { status: 'confirmed', source: 'backoffice', daysAgo: 8 },
          ],
        },
      },
      {
        title: 'Advanced injection techniques',
        titleI18n: { hy: 'Ներարկային տեխնիկաներ՝ խորացված դասընթաց', ru: 'Продвинутые инъекционные техники' },
        summary: 'For practising doctors only. Dates and pricing on request.',
        summaryI18n: {
          hy: 'Միայն գործող բժիշկների համար։ Ամսաթվերը և արժեքը՝ ըստ հարցման։',
          ru: 'Только для практикующих врачей. Даты и стоимость — по запросу.',
        },
        description: 'Draft — not published yet. Curriculum is being finalised with the guest faculty.',
        priceMode: 'hidden',
        level: 'advanced',
        tutor: { specialist: 'lilit' },
        active: false,
        cover: null,
        createdDaysAgo: 3,
        current: {
          status: 'draft', location: 'kentron', startInDays: null,
          scheduleText: '', capacity: 6, registrationOpen: false, members: [],
        },
      },
    ],
    vacancies: [
      {
        specialtyKey: 'cosmetology', location: 'arabkir', seats: 2,
        description:
          'We are looking for a cosmetologist to join our Arabkir team. You get a steady flow of clients from our online booking, premium professional brands and monthly in-house training. Your share grows with your experience and client retention.',
        descriptionI18n: {
          hy: 'Փնտրում ենք կոսմետոլոգ մեր Արաբկիրի թիմի համար։ Կունենաք հաճախորդների կայուն հոսք մեր առցանց ամրագրման շնորհիվ, պրոֆեսիոնալ պրեմիում բրենդներ և ամենամսյա ներքին ուսուցում։ Ձեր բաժինը աճում է փորձի և հաճախորդների պահպանման հետ միասին։',
          ru: 'Ищем косметолога в команду филиала в Арабкире. Стабильный поток клиентов через онлайн-запись, профессиональные премиальные бренды и ежемесячное обучение внутри клиники. Ваша доля растёт вместе с опытом и удержанием клиентов.',
        },
        payType: 'percentage', salonPercent: 40, salonPercentMax: 50,
        scheduleType: 'full_time', experience: 'experienced',
        perks: ['materials-included', 'client-base-provided', 'online-booking', 'training-provided', 'official-contract'],
        applyMode: 'both', contactPhone: '+374 91 10 10 10',
        state: 'published', publishedDaysAgo: 6, cover: 'skin', applicants: 5,
      },
      {
        specialtyKey: 'laser-cosmetology', location: 'kentron',
        description:
          'Laser specialist for our Kentron branch. Fixed monthly salary plus a bonus for every certified course you complete. Experience with diode or alexandrite lasers is required.',
        descriptionI18n: {
          hy: 'Լազերային մասնագետ մեր Կենտրոնի մասնաճյուղի համար։ Ֆիքսված ամսական աշխատավարձ և բոնուս յուրաքանչյուր ավարտված սերտիֆիկացված դասընթացի համար։ Պարտադիր է դիոդային կամ ալեքսանդրիտային լազերով աշխատելու փորձը։',
          ru: 'Специалист по лазеру в филиал Кентрон. Фиксированная ежемесячная зарплата плюс бонус за каждый пройденный сертифицированный курс. Обязателен опыт работы с диодным или александритовым лазером.',
        },
        payType: 'salary', amount: 300000, amountMax: 450000, payPeriod: 'month',
        scheduleType: 'full_time', experience: 'experienced',
        perks: ['official-contract', 'training-provided', 'uniform-provided', 'meals'],
        applyMode: 'in_app',
        state: 'published', publishedDaysAgo: 12, applicants: 3,
      },
      {
        specialtyKey: 'administration', location: 'arabkir',
        description:
          'Front desk administrator: greet clients, run the calendar in Reserva, answer calls and messages. Shifts 2/2, friendly team, lunch included.',
        descriptionI18n: {
          hy: 'Ադմինիստրատոր ընդունարանում՝ դիմավորել հաճախորդներին, վարել օրացույցը Reserva-ում, պատասխանել զանգերին և հաղորդագրություններին։ Հերթափոխ 2/2, ընկերական թիմ, ճաշը՝ մեր կողմից։',
          ru: 'Администратор на ресепшен: встречать клиентов, вести календарь в Reserva, отвечать на звонки и сообщения. График 2/2, дружный коллектив, обед за наш счёт.',
        },
        payType: 'salary', amount: 220000, payPeriod: 'month',
        scheduleType: 'shift', scheduleNote: '2/2 · 10:00–19:00', experience: 'any',
        perks: ['official-contract', 'meals', 'transport'],
        applyMode: 'both', contactPhone: '+374 10 24 56 78',
        state: 'published', publishedDaysAgo: 2, applicants: 4,
      },
      {
        specialtyKey: 'dermatology', location: 'kentron',
        description: 'Part-time dermatologist for consultations and injectables. Terms are discussed individually.',
        descriptionI18n: {
          hy: 'Մաշկաբան՝ կես դրույքով, խորհրդատվությունների և ներարկային պրոցեդուրաների համար։ Պայմանները քննարկվում են անհատապես։',
          ru: 'Дерматолог на неполный день для консультаций и инъекционных процедур. Условия обсуждаются индивидуально.',
        },
        payType: 'negotiable', scheduleType: 'part_time', experience: 'experienced',
        perks: ['flexible-schedule', 'parking'],
        applyMode: 'phone', contactPhone: '+374 10 53 11 02',
        state: 'draft', applicants: 0,
      },
      {
        specialtyKey: 'facials', location: 'kentron',
        description: 'Junior aesthetician for facials. We train you on our protocols, and you keep half of every procedure.',
        descriptionI18n: {
          hy: 'Սկսնակ էսթետիստ դեմքի խնամքի պրոցեդուրաների համար։ Կսովորեցնենք մեր պրոտոկոլները, իսկ յուրաքանչյուր պրոցեդուրայի կեսը ձերն է։',
          ru: 'Начинающий эстетист для уходовых процедур. Обучим нашим протоколам, половина стоимости каждой процедуры — ваша.',
        },
        payType: 'percentage', salonPercent: 50,
        scheduleType: 'part_time', experience: 'junior',
        perks: ['training-provided', 'tools-provided', 'materials-included'],
        applyMode: 'both', contactPhone: '+374 10 53 11 02',
        state: 'paused', publishedDaysAgo: 20, applicants: 2,
      },
      {
        specialtyKey: 'other', location: 'arabkir',
        title: 'Evening cleaner',
        titleI18n: { hy: 'Երեկոյան հավաքարար', ru: 'Уборщица (вечерняя смена)' },
        description: 'Two hours every evening after closing. Position filled — kept for reference.',
        descriptionI18n: {
          hy: 'Ամեն երեկո երկու ժամ՝ փակվելուց հետո։ Հաստիքը համալրված է։',
          ru: 'Два часа каждый вечер после закрытия. Вакансия закрыта.',
        },
        payType: 'salary', amount: 90000, payPeriod: 'month',
        scheduleType: 'part_time', experience: 'any',
        perks: ['transport'],
        applyMode: 'phone', contactPhone: '+374 10 24 56 78',
        state: 'closed', publishedDaysAgo: 25, applicants: 3,
      },
      {
        specialtyKey: 'laser-hair-removal', location: 'arabkir',
        title: 'Laser room for rent',
        titleI18n: { hy: 'Լազերային սենյակ վարձով', ru: 'Аренда лазерного кабинета' },
        description:
          'Laser room for rent by the day, for a specialist with their own clients. Device maintenance and consumables are included.',
        descriptionI18n: {
          hy: 'Օրավարձով լազերային սենյակ՝ սեփական հաճախորդներ ունեցող մասնագետի համար։ Սարքի սպասարկումը և ծախսանյութերը ներառված են։',
          ru: 'Посуточная аренда лазерного кабинета для специалиста со своими клиентами. Обслуживание аппарата и расходники включены.',
        },
        payType: 'rent', amount: 8000, payPeriod: 'day',
        scheduleType: 'flexible', experience: 'experienced',
        perks: ['own-client-base', 'materials-included', 'parking'],
        applyMode: 'phone', contactPhone: '+374 91 10 10 10',
        state: 'expired', publishedDaysAgo: 36, applicants: 1,
      },
    ],
    support: {
      status: 'open',
      messages: [
        { from: 'partner', text: 'Hi! How do we add a second manager for the Kentron branch?', minutesAgo: 60 * 72, read: true },
        { from: 'platform', text: 'Hello Armen! Go to Users → Add user, choose the Manager role and the Kentron branch. They will get a one-time password and set their own on first login.', minutesAgo: 60 * 71, read: true },
        { from: 'partner', text: 'Done, thank you! One more thing: can the course page show prices in USD?', minutesAgo: 60 * 49, read: true },
        { from: 'platform', text: 'Prices are in AMD for now — multi-currency is on our roadmap. We will let you know as soon as it ships!', minutesAgo: 60 * 20, read: false },
      ],
    },
  },

  // ── 2. BarberBro — tabbed page, auto-confirm, overnight ─────
  {
    purpose: 'Barbershop — tabbed page, auto-confirmed bookings, Fri/Sat shift past midnight (to 02:30), chair-rental vacancies, per-barber prices on ONE branch (pricing switch on)',
    slug: 'barberbro',
    name: 'BarberBro',
    nameI18n: { hy: 'ԲարբերԲրո', ru: 'БарберБро' },
    type: 'Barbershop',
    typeI18n: { hy: 'Բարբերշոփ', ru: 'Барбершоп' },
    kind: 'salon',
    template: 'tabbed',
    supportWidget: 'book',
    defaultLocale: 'hy',
    accent: '#2F4A3A',
    autoConfirmBookings: true,
    marketplaceListed: true,
    createdDaysAgo: 120,
    products: [{ key: 'bookings' }, { key: 'vacancies' }],
    presentation: {
      tagline: 'Sharp cuts, classic vibes, no appointments-by-DM',
      taglineI18n: {
        hy: 'Կոկիկ սանրվածքներ, դասական մթնոլորտ և ոչ մի գրանցում DM-ով',
        ru: 'Чёткие стрижки, классическая атмосфера и никаких записей через директ',
      },
      about:
        'BarberBro is where craft meets attitude. Walk in for a precise fade, a clean beard line-up, or the full combo — and walk out feeling like the best version of yourself. Booked online in seconds, finished in style. On Fridays and Saturdays we stay open until 02:30.',
      aboutI18n: {
        hy: 'ԲարբերԲրոն այն վայրն է, որտեղ վարպետությունը հանդիպում է ոճին։ Եկեք ճշգրիտ ֆեյդի, մորուքի կոկիկ ձևավորման կամ ամբողջական կոմբոյի համար և դուրս եկեք ձեր լավագույն տարբերակով։ Ամրագրումը՝ վայրկյանների ընթացքում, արդյունքը՝ ոճային։ Ուրբաթ և շաբաթ օրերին աշխատում ենք մինչև 02:30։',
        ru: 'БарберБро — место, где мастерство встречается со стилем. Приходите за точным фейдом, аккуратным оформлением бороды или полным комбо — и уходите лучшей версией себя. Запись онлайн за секунды, результат — со вкусом. По пятницам и субботам работаем до 02:30.',
      },
      hours: 'Daily · 11:00–21:00 · Fri–Sat till 02:30',
      instagram: 'https://instagram.com/reserva.am',
      whatsapp: '37493303030',
      heroTints: ['#2F4A3A', '#1E3225'],
      logo: { text: 'BB', style: 'sans' },
      gallery: [
        { label: 'The chair', motif: 'room' },
        { label: 'Storefront', motif: 'facade' },
        { label: 'Tools', motif: 'mirror' },
        { label: 'Waiting area', motif: 'lounge' },
      ],
      works: [
        { label: 'Skin fade', motif: 'fade' },
        { label: 'Beard line-up', motif: 'fade', beforeAfter: true },
        { label: 'Textured crop', motif: 'hair' },
      ],
    },
    locations: [
      {
        key: 'mashtots',
        name: 'Mashtots',
        nameI18n: { hy: 'Մաշտոց', ru: 'Маштоц' },
        address: '22 Mashtots Ave, Yerevan',
        phone: '+374 10 44 22 11',
        areaKey: 'yerevan-kentron',
        lat: 40.1859,
        lng: 44.5081,
        hours: week({
          mon: ['11:00', '21:00'], tue: ['11:00', '21:00'], wed: ['11:00', '21:00'], thu: ['11:00', '21:00'],
          fri: ['11:00', '02:30'], sat: ['11:00', '02:30'], sun: ['12:00', '20:00'],
        }),
      },
    ],
    services: [
      { key: 'cut', name: 'Haircut', nameI18n: { hy: 'Սանրվածք', ru: 'Стрижка' }, category: 'Hair', categoryI18n: CAT.hair, price: 5000, duration: 30, repeatEveryDays: 21 },
      { key: 'fade', name: 'Skin fade', nameI18n: { hy: 'Սքին ֆեյդ', ru: 'Скин фейд' }, category: 'Hair', categoryI18n: CAT.hair, price: 6000, duration: 40, repeatEveryDays: 21 },
      { key: 'beard', name: 'Beard trim & shape', nameI18n: { hy: 'Մորուքի կտրում և ձևավորում', ru: 'Стрижка и оформление бороды' }, category: 'Beard', categoryI18n: CAT.beard, price: 3000, duration: 20, repeatEveryDays: 14 },
      { key: 'shave', name: 'Hot towel royal shave', nameI18n: { hy: 'Թագավորական սափրում տաք սրբիչով', ru: 'Королевское бритьё с горячим полотенцем' }, category: 'Beard', categoryI18n: CAT.beard, price: 6500, duration: 40 },
      { key: 'combo', name: 'Haircut + beard', nameI18n: { hy: 'Սանրվածք + մորուք', ru: 'Стрижка + борода' }, category: 'Combo', categoryI18n: CAT.combo, price: 7500, duration: 50, repeatEveryDays: 21 },
      { key: 'kids', name: 'Kids haircut (under 12)', nameI18n: { hy: 'Մանկական սանրվածք (մինչև 12 տարեկան)', ru: 'Детская стрижка (до 12 лет)' }, category: 'Hair', categoryI18n: CAT.hair, price: 4000, duration: 30 },
      { key: 'camo', name: 'Grey blending', nameI18n: { hy: 'Ճերմակ մազերի քողարկում', ru: 'Камуфляж седины' }, category: 'Hair', categoryI18n: CAT.hair, price: 8000, priceMax: 15000, duration: 45 },
    ],
    specialists: [
      {
        key: 'armen', name: 'Armen Grigoryan', nameI18n: { hy: 'Արմեն Գրիգորյան', ru: 'Армен Григорян' },
        title: 'Senior barber', titleI18n: { hy: 'Ավագ բարբեր', ru: 'Старший барбер' },
        location: 'mashtots', phone: '+37493112233',
        // Late shift on Fri/Sat: 16:00 → 02:30 the next morning.
        schedule: week({ mon: ['11:00', '21:00'], tue: ['11:00', '21:00'], wed: ['11:00', '21:00'], fri: ['16:00', '02:30'], sat: ['16:00', '02:30'] }),
        services: ['cut', 'fade', 'beard', 'shave', 'combo', 'camo'], avatar: true, reviews: 16,
      },
      {
        key: 'vardan', name: 'Vardan Mkrtchyan', nameI18n: { hy: 'Վարդան Մկրտչյան', ru: 'Вардан Мкртчян' },
        title: 'Barber', titleI18n: { hy: 'Բարբեր', ru: 'Барбер' },
        location: 'mashtots', phone: '+37493445566',
        schedule: week({ tue: ['11:00', '20:00'], wed: ['11:00', '20:00'], thu: ['11:00', '20:00'], fri: ['11:00', '20:00'], sat: ['11:00', '20:00'], sun: ['12:00', '20:00'] }),
        services: ['cut', 'fade', 'beard', 'combo', 'kids'], avatar: true, reviews: 10,
      },
      {
        key: 'hayk', name: 'Hayk Ghazaryan', nameI18n: { hy: 'Հայկ Ղազարյան', ru: 'Айк Казарян' },
        title: 'Junior barber', titleI18n: { hy: 'Կրտսեր բարբեր', ru: 'Младший барбер' },
        location: 'mashtots', phone: '+37493778899',
        schedule: week({ mon: ['12:00', '20:00'], wed: ['12:00', '20:00'], thu: ['12:00', '20:00'], fri: ['12:00', '23:00'], sat: ['12:00', '23:00'] }),
        services: ['cut', 'beard', 'kids'], avatar: false, reviews: 4,
        timeOff: [{ day: 4, days: 1, reason: 'Exam at the academy' }],
      },
    ],
    // One branch, three price levels: the senior barber charges more, the junior
    // less (and takes longer) — specialist pricing without any branches.
    branchPricing: true,
    specialistPrices: [
      { specialist: 'armen', location: 'mashtots', service: 'cut', price: 6000 },
      { specialist: 'armen', location: 'mashtots', service: 'combo', price: 9000, duration: 60 },
      { specialist: 'hayk', location: 'mashtots', service: 'cut', price: 4000, duration: 40 },
    ],
    users: [{ name: 'Armen Grigoryan', email: 'admin@barberbro.am', phone: '+37493303030', role: 'admin', lastSeenHoursAgo: 3 }],
    bookings: { fromDay: -21, toDay: 10, perDay: [3, 6], publicShare: 0.75, clients: 30 },
    vacancies: [
      {
        specialtyKey: 'barbering', location: 'mashtots', seats: 2,
        description:
          'Chair for rent in a busy barbershop on Mashtots Avenue. You keep everything you earn; we handle the bookings, towels, coffee and marketing.',
        descriptionI18n: {
          hy: 'Աթոռ վարձով Մաշտոցի պողոտայի զբաղված բարբերշոփում։ Ամբողջ վաստակը ձերն է, իսկ ամրագրումները, սրբիչները, սուրճը և մարքեթինգը՝ մերը։',
          ru: 'Кресло в аренду в загруженном барбершопе на проспекте Маштоца. Весь заработок ваш, а запись, полотенца, кофе и маркетинг — на нас.',
        },
        payType: 'rent', amount: 150000, payPeriod: 'month',
        scheduleType: 'flexible', experience: 'experienced',
        perks: ['online-booking', 'client-base-provided', 'parking', 'own-tools'],
        applyMode: 'both', contactPhone: '+374 93 30 30 30',
        state: 'published', publishedDaysAgo: 4, cover: 'fade', applicants: 3,
      },
      {
        specialtyKey: 'barbering', location: 'mashtots',
        title: 'Junior barber — training provided',
        titleI18n: { hy: 'Կրտսեր բարբեր՝ ուսուցմամբ', ru: 'Младший барбер с обучением' },
        description:
          'Just finished a course? Learn next to our senior barbers. You keep 50% of every haircut from day one.',
        descriptionI18n: {
          hy: 'Նոր եք ավարտել դասընթացը։ Սովորեք մեր ավագ բարբերների կողքին։ Առաջին իսկ օրվանից յուրաքանչյուր սանրվածքի 50%-ը ձերն է։',
          ru: 'Только окончили курсы? Учитесь рядом с нашими старшими барберами. С первого дня 50% с каждой стрижки — ваши.',
        },
        payType: 'percentage', salonPercent: 50,
        scheduleType: 'full_time', experience: 'junior',
        perks: ['training-provided', 'tools-provided', 'materials-included', 'online-booking'],
        applyMode: 'in_app',
        state: 'published', publishedDaysAgo: 9, applicants: 4,
      },
    ],
    support: {
      status: 'open',
      messages: [
        { from: 'partner', text: 'Բարև Ձեզ։ Ուրբաթ և շաբաթ օրերին աշխատում ենք մինչև 02:30 — կայքում ճի՞շտ է ցուցադրվում։', minutesAgo: 300, read: false },
        { from: 'partner', text: 'Եվ հնարավո՞ր է, որ երրորդ վարպետը տեսնի միայն իր ամրագրումները։', minutesAgo: 285, read: false },
      ],
    },
  },

  // ── 3. Lumé Studio — courses, hidden prices, suspended product
  {
    purpose: 'Nail & lash studio — a course, hidden prices, repeat reminders; vacancies product SUSPENDED (its listing is hidden from the board)',
    slug: 'lume',
    name: 'Lumé Studio',
    nameI18n: { hy: 'Լյումե Ստուդիո', ru: 'Люме Студио' },
    type: 'Beauty studio',
    typeI18n: { hy: 'Գեղեցկության ստուդիա', ru: 'Студия красоты' },
    kind: 'salon',
    template: 'classic',
    supportWidget: 'hidden',
    defaultLocale: 'ru',
    accent: '#B07683',
    marketplaceListed: true,
    createdDaysAgo: 95,
    products: [
      { key: 'bookings' },
      { key: 'courses', byStaff: true },
      { key: 'vacancies', status: 'suspended', suspendedDaysAgo: 10 },
    ],
    presentation: {
      tagline: 'Soft glamour & flawless detail by the Cascade',
      taglineI18n: { hy: 'Նուրբ գլամուր և անթերի մանրուքներ Կասկադի մոտ', ru: 'Нежный гламур и безупречные детали у Каскада' },
      about:
        'Lumé Studio is a haven for nails, lashes and brows — where every detail is finished to perfection. Our artists blend technique with a gentle touch, so you leave glowing and ready to be seen. Quietly luxurious, effortlessly you.',
      aboutI18n: {
        hy: 'Լյումե Ստուդիոն եղունգների, թարթիչների և հոնքերի խնամքի անկյուն է, որտեղ ամեն մանրուք կատարյալ է։ Մեր վարպետները համադրում են տեխնիկան և նրբությունը, որպեսզի դուք դուրս գաք փայլուն և ինքնավստահ։ Հանգիստ շքեղություն՝ առանց ավելորդության։',
        ru: 'Lumé Studio — уголок для ногтей, ресниц и бровей, где каждая деталь доведена до совершенства. Наши мастера сочетают технику и деликатность, чтобы вы ушли сияющей и уверенной в себе. Тихая роскошь — без лишнего.',
      },
      hours: 'Mon–Sat · 10:00–20:00',
      instagram: 'https://instagram.com/reserva.am',
      whatsapp: '37499303030',
      heroTints: ['#B07683', '#7A4A55'],
      logo: { text: 'L', style: 'italic' },
      gallery: [
        { label: 'Nail bar', motif: 'mirror' },
        { label: 'Lash room', motif: 'room' },
        { label: 'Studio', motif: 'lounge' },
        { label: 'Entrance', motif: 'facade' },
      ],
      works: [
        { label: 'Gel manicure', motif: 'nails', beforeAfter: true },
        { label: 'Volume lashes', motif: 'lashes', beforeAfter: true },
        { label: 'Nude french', motif: 'nails' },
      ],
    },
    locations: [
      {
        key: 'cascade',
        name: 'Cascade',
        nameI18n: { hy: 'Կասկադ', ru: 'Каскад' },
        address: '5 Tamanyan St, Yerevan',
        phone: '+374 10 77 88 99',
        areaKey: 'yerevan-kentron',
        lat: 40.1907,
        lng: 44.5153,
        hours: daily('10:00', '20:00'),
      },
    ],
    services: [
      { key: 'mani', name: 'Classic manicure', nameI18n: { hy: 'Դասական մատնահարդարում', ru: 'Классический маникюр' }, category: 'Nails', categoryI18n: CAT.nails, price: 8000, duration: 60, repeatEveryDays: 21 },
      { key: 'gel', name: 'Gel polish manicure', nameI18n: { hy: 'Մատնահարդարում գել-լաքով', ru: 'Маникюр с покрытием гель-лак' }, category: 'Nails', categoryI18n: CAT.nails, price: 12000, duration: 90, repeatEveryDays: 21 },
      { key: 'pedi', name: 'Classic pedicure', nameI18n: { hy: 'Դասական ոտնահարդարում', ru: 'Классический педикюр' }, category: 'Nails', categoryI18n: CAT.nails, price: 10000, duration: 75, repeatEveryDays: 28 },
      { key: 'art', name: 'Nail art', nameI18n: { hy: 'Եղունգների դիզայն', ru: 'Дизайн ногтей' }, category: 'Nails', categoryI18n: CAT.nails, price: 2000, priceMax: 8000, duration: 30 },
      { key: 'bridal', name: 'Bridal nail design', nameI18n: { hy: 'Հարսանեկան եղունգների դիզայն', ru: 'Свадебный дизайн ногтей' }, category: 'Nails', categoryI18n: CAT.nails, price: 25000, duration: 120, hidePrice: true },
      { key: 'lash', name: 'Lash extensions — classic', nameI18n: { hy: 'Թարթիչների երկարացում — դասական', ru: 'Наращивание ресниц — классика' }, category: 'Lashes', categoryI18n: CAT.lashes, price: 18000, duration: 120, repeatEveryDays: 21 },
      { key: 'lash-volume', name: 'Lash extensions — volume', nameI18n: { hy: 'Թարթիչների երկարացում — ծավալային', ru: 'Наращивание ресниц — объём' }, category: 'Lashes', categoryI18n: CAT.lashes, price: 25000, duration: 150, repeatEveryDays: 21 },
      { key: 'lift', name: 'Lash lift & tint', nameI18n: { hy: 'Թարթիչների լամինացիա և ներկում', ru: 'Ламинирование и окрашивание ресниц' }, category: 'Lashes', categoryI18n: CAT.lashes, price: 15000, duration: 60, repeatEveryDays: 42 },
      { key: 'brow', name: 'Brow shaping', nameI18n: { hy: 'Հոնքերի ձևավորում', ru: 'Коррекция бровей' }, category: 'Brows', categoryI18n: CAT.brows, price: 6000, duration: 30, repeatEveryDays: 28 },
      { key: 'brow-lam', name: 'Brow lamination', nameI18n: { hy: 'Հոնքերի լամինացիա', ru: 'Ламинирование бровей' }, category: 'Brows', categoryI18n: CAT.brows, price: 12000, duration: 45, repeatEveryDays: 42 },
    ],
    specialists: [
      {
        key: 'naira', name: 'Naira Hovhannisyan', nameI18n: { hy: 'Նաիրա Հովհաննիսյան', ru: 'Наира Ованнисян' },
        title: 'Nail artist', titleI18n: { hy: 'Մատնահարդար', ru: 'Мастер маникюра' },
        location: 'cascade', phone: '+37499112233', schedule: daily('10:00', '20:00'),
        services: ['mani', 'gel', 'pedi', 'art', 'bridal'], avatar: true, reviews: 12,
      },
      {
        key: 'silva', name: 'Silva Abrahamyan', nameI18n: { hy: 'Սիլվա Աբրահամյան', ru: 'Сильва Абраамян' },
        title: 'Lash & brow artist', titleI18n: { hy: 'Թարթիչների և հոնքերի մասնագետ', ru: 'Мастер по ресницам и бровям' },
        location: 'cascade', phone: '+37499445566', schedule: daily('11:00', '20:00', ['mon', 'tue', 'wed', 'thu', 'fri']),
        services: ['lash', 'lash-volume', 'lift', 'brow', 'brow-lam'], avatar: true, reviews: 9,
      },
      {
        key: 'elen', name: 'Elen Baghdasaryan', nameI18n: { hy: 'Էլեն Բաղդասարյան', ru: 'Элен Багдасарян' },
        title: 'Junior nail artist', titleI18n: { hy: 'Կրտսեր մատնահարդար', ru: 'Младший мастер маникюра' },
        location: 'cascade', phone: '+37499778899', schedule: daily('12:00', '20:00', ['tue', 'wed', 'thu', 'fri', 'sat']),
        services: ['mani', 'gel', 'pedi'], avatar: false, reviews: 2,
      },
    ],
    users: [{ name: 'Naira Hovhannisyan', email: 'admin@lume.am', phone: '+37499303030', role: 'admin', lastSeenHoursAgo: 20 }],
    bookings: { fromDay: -21, toDay: 12, perDay: [2, 4], publicShare: 0.7, clients: 24 },
    courses: [
      {
        title: 'Gel manicure from zero',
        titleI18n: { hy: 'Գել մատնահարդարում՝ զրոյից', ru: 'Маникюр с гель-лаком с нуля' },
        summary: 'Two weeks, a small group, and your own practice kit to take home.',
        summaryI18n: {
          hy: 'Երկու շաբաթ, փոքր խումբ և սեփական պրակտիկայի հավաքածու, որը կմնա ձեզ։',
          ru: 'Две недели, маленькая группа и собственный набор для практики, который останется у вас.',
        },
        description:
          'Hygiene and sterilisation, cuticle work, gel polish application and removal, French and simple designs. Practice on models from the second lesson.',
        descriptionI18n: {
          hy: 'Հիգիենա և ստերիլիզացիա, կուտիկուլայի մշակում, գել-լաքի կիրառում և հեռացում, ֆրենչ և պարզ դիզայններ։ Պրակտիկա մոդելների վրա՝ երկրորդ դասից։',
          ru: 'Гигиена и стерилизация, обработка кутикулы, нанесение и снятие гель-лака, френч и простые дизайны. Практика на моделях со второго занятия.',
        },
        priceMode: 'paid',
        price: 120000,
        level: 'beginner',
        tutor: { specialist: 'naira' },
        active: true,
        cover: 'nails',
        createdDaysAgo: 30,
        current: {
          status: 'open', location: 'cascade', startInDays: 10, lengthDays: 12,
          scheduleText: 'Mon, Wed, Fri · 11:00–15:00', capacity: 6, registrationOpen: true,
          members: [
            { status: 'confirmed', source: 'backoffice', daysAgo: 8 },
            { status: 'confirmed', source: 'public', daysAgo: 5 },
            { status: 'pending', source: 'public', daysAgo: 1 },
          ],
        },
      },
    ],
    vacancies: [
      {
        specialtyKey: 'manicure', location: 'cascade',
        description:
          'Manicurist with at least a year of experience. Salary plus percentage, premium materials and a cosy studio by the Cascade.',
        descriptionI18n: {
          hy: 'Մատնահարդար՝ առնվազն մեկ տարվա փորձով։ Աշխատավարձ և տոկոս, պրեմիում նյութեր և հարմարավետ ստուդիա Կասկադի մոտ։',
          ru: 'Мастер маникюра с опытом от года. Оклад плюс процент, премиальные материалы и уютная студия у Каскада.',
        },
        payType: 'salary', amount: 200000, amountMax: 280000, payPeriod: 'month',
        scheduleType: 'full_time', experience: 'experienced',
        perks: ['materials-included', 'official-contract', 'online-booking'],
        applyMode: 'both', contactPhone: '+374 99 30 30 30',
        state: 'published', publishedDaysAgo: 14, applicants: 2,
      },
    ],
    support: {
      status: 'closed',
      messages: [
        { from: 'partner', text: 'Здравствуйте! Не приходят пуш-уведомления о новых записях.', minutesAgo: 60 * 24 * 20, read: true },
        { from: 'platform', text: 'Добрый день! Проверьте, что уведомления для сайта разрешены в настройках браузера, а затем нажмите «Включить уведомления» в разделе «Настройки».', minutesAgo: 60 * 24 * 20 - 25, read: true },
        { from: 'partner', text: 'Всё заработало, спасибо!', minutesAgo: 60 * 24 * 19, read: true },
      ],
    },
  },

  // ── 4. Avanta — spa with facility services ──────────────────
  {
    purpose: 'Wellness & spa — 2 branches, facility services without a specialist (sauna, pool) limited by capacity, branch manager',
    slug: 'avanta',
    name: 'Avanta',
    nameI18n: { hy: 'Ավանտա', ru: 'Аванта' },
    type: 'Wellness & spa',
    typeI18n: { hy: 'Վելնես և սպա', ru: 'Велнес и спа' },
    kind: 'salon',
    template: 'tabbed',
    supportWidget: 'support',
    defaultLocale: 'en',
    accent: '#1FA84C',
    marketplaceListed: true,
    createdDaysAgo: 70,
    products: [{ key: 'bookings' }, { key: 'vacancies' }],
    presentation: {
      tagline: 'Restore, recharge, renew — naturally',
      taglineI18n: { hy: 'Վերականգնվեք, լիցքավորվեք, թարմացեք՝ բնականորեն', ru: 'Восстановление, энергия, обновление — естественно' },
      about:
        'Avanta is a sanctuary for body and mind, where natural therapies meet expert hands. From deep-tissue massage to detoxifying body rituals, every treatment is designed to leave you lighter, calmer and renewed. Our sauna and thermal pool are open to day guests — no therapist needed.',
      aboutI18n: {
        hy: 'Ավանտան մարմնի և հոգու ապաստարան է, որտեղ բնական թերապիաները հանդիպում են վարպետ ձեռքերին։ Խորը մերսումից մինչև դետոքս ծեսեր՝ յուրաքանչյուր պրոցեդուրա ստեղծված է, որպեսզի ձեզ զգաք ավելի թեթև, հանգիստ և թարմացած։ Մեր սաունան և ջերմային լողավազանը բաց են օրական այցելուների համար՝ առանց մասնագետի ամրագրման։',
        ru: 'Аванта — пространство для тела и души, где натуральные практики встречаются с опытными руками. От глубокого массажа до детокс-ритуалов — каждая процедура создана, чтобы вы почувствовали лёгкость, спокойствие и обновление. Сауна и термальный бассейн открыты для гостей на день — без записи к специалисту.',
      },
      hours: 'Daily · 09:00–21:00',
      instagram: 'https://instagram.com/reserva.am',
      facebook: 'https://facebook.com/reserva.am',
      whatsapp: '37494303030',
      heroTints: ['#1FA84C', '#0E6B30'],
      logo: { text: 'Av', style: 'serif' },
      gallery: [
        { label: 'Massage suite', motif: 'room' },
        { label: 'Relaxation lounge', motif: 'lounge' },
        { label: 'Thermal pool', motif: 'detail' },
        { label: 'Reception', motif: 'reception' },
      ],
      works: [
        { label: 'Hot stone ritual', motif: 'spa' },
        { label: 'Detox body wrap', motif: 'spa', beforeAfter: true },
      ],
    },
    locations: [
      {
        key: 'northern', name: 'Northern Ave', nameI18n: { hy: 'Հյուսիսային պողոտա', ru: 'Северный проспект' },
        address: '8 Northern Ave, Yerevan', phone: '+374 10 50 60 70',
        areaKey: 'yerevan-kentron', lat: 40.1842, lng: 44.5149,
        hours: daily('09:00', '21:00', ALL_DAYS),
      },
      {
        key: 'komitas', name: 'Komitas', nameI18n: { hy: 'Կոմիտաս', ru: 'Комитас' },
        address: '41 Komitas Ave, Yerevan', phone: '+374 10 33 77 22',
        areaKey: 'yerevan-arabkir', lat: 40.2089, lng: 44.5043,
        hours: daily('09:00', '21:00', ALL_DAYS),
      },
    ],
    services: [
      { key: 'classic', name: 'Classic massage', nameI18n: { hy: 'Դասական մերսում', ru: 'Классический массаж' }, category: 'Massage', categoryI18n: CAT.massage, price: 12000, duration: 60, repeatEveryDays: 14 },
      { key: 'deep', name: 'Deep tissue massage', nameI18n: { hy: 'Խորը հյուսվածքների մերսում', ru: 'Глубокий массаж тканей' }, category: 'Massage', categoryI18n: CAT.massage, price: 16000, duration: 75 },
      { key: 'stone', name: 'Hot stone massage', nameI18n: { hy: 'Մերսում տաք քարերով', ru: 'Массаж горячими камнями' }, category: 'Massage', categoryI18n: CAT.massage, price: 18000, duration: 90 },
      { key: 'aroma', name: 'Aromatherapy', nameI18n: { hy: 'Արոմաթերապիա', ru: 'Ароматерапия' }, category: 'Therapy', categoryI18n: CAT.therapy, price: 14000, duration: 60 },
      { key: 'scrub', name: 'Body scrub', nameI18n: { hy: 'Մարմնի սկրաբ', ru: 'Скраб для тела' }, category: 'Body', categoryI18n: CAT.body, price: 11000, duration: 45 },
      { key: 'wrap', name: 'Detox body wrap', nameI18n: { hy: 'Դետոքս փաթաթում', ru: 'Детокс-обёртывание' }, category: 'Body', categoryI18n: CAT.body, price: 20000, duration: 90, repeatEveryDays: 10 },
      { key: 'sauna', name: 'Sauna & steam — day pass', nameI18n: { hy: 'Սաունա և շոգեբաղնիք — օրական մուտք', ru: 'Сауна и хаммам — дневной доступ' }, category: 'Spa zone', categoryI18n: CAT.spaZone, price: 7000, duration: 120, capacity: 6 },
      { key: 'pool', name: 'Thermal pool — 3 hours', nameI18n: { hy: 'Ջերմային լողավազան — 3 ժամ', ru: 'Термальный бассейн — 3 часа' }, category: 'Spa zone', categoryI18n: CAT.spaZone, price: 10000, duration: 180, capacity: 10 },
    ],
    specialists: [
      {
        key: 'gohar', name: 'Gohar Davtyan', nameI18n: { hy: 'Գոհար Դավթյան', ru: 'Гоар Давтян' },
        title: 'Lead therapist', titleI18n: { hy: 'Գլխավոր թերապևտ', ru: 'Ведущий терапевт' },
        location: 'northern', phone: '+37494102030', schedule: daily('09:00', '18:00'),
        services: ['classic', 'aroma', 'scrub', 'wrap'], avatar: true, reviews: 10,
      },
      {
        key: 'tigran', name: 'Tigran Karapetyan', nameI18n: { hy: 'Տիգրան Կարապետյան', ru: 'Тигран Карапетян' },
        title: 'Massage therapist', titleI18n: { hy: 'Մերսող', ru: 'Массажист' },
        location: 'northern', phone: '+37494405060', schedule: daily('12:00', '21:00', ['tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
        services: ['classic', 'deep', 'stone'], avatar: true, reviews: 8,
      },
      {
        key: 'ani', name: 'Ani Melkonyan', nameI18n: { hy: 'Անի Մելքոնյան', ru: 'Ани Мелконян' },
        title: 'Spa specialist', titleI18n: { hy: 'Սպա մասնագետ', ru: 'Спа-специалист' },
        location: 'komitas', phone: '+37494708090', schedule: daily('09:00', '18:00'),
        services: ['aroma', 'scrub', 'wrap'], avatar: false, reviews: 5,
      },
      {
        key: 'levon', name: 'Levon Sahakyan', nameI18n: { hy: 'Լևոն Սահակյան', ru: 'Левон Саакян' },
        title: 'Massage therapist', titleI18n: { hy: 'Մերսող', ru: 'Массажист' },
        location: 'komitas', phone: '+37494112299', schedule: daily('11:00', '21:00', ['mon', 'wed', 'fri', 'sat', 'sun']),
        services: ['classic', 'deep', 'stone'], avatar: true, reviews: 6,
        timeOff: [{ day: 1, days: 2, reason: 'Sick leave' }],
      },
    ],
    users: [
      { name: 'Gohar Davtyan', email: 'admin@avanta.am', phone: '+37494303030', role: 'admin', lastSeenHoursAgo: 8 },
      { name: 'Lusine Arakelyan', email: 'manager@avanta.am', phone: '+37494404040', role: 'manager', location: 'komitas', lastSeenHoursAgo: 50 },
    ],
    bookings: { fromDay: -21, toDay: 10, perDay: [2, 4], facilityPerDay: [2, 5], publicShare: 0.65, clients: 28 },
    vacancies: [
      {
        specialtyKey: 'massage', location: 'northern',
        description:
          'Massage therapist with a medical background. Steady client flow, and you keep 55% of every session.',
        descriptionI18n: {
          hy: 'Մերսող՝ բժշկական կրթությամբ։ Հաճախորդների կայուն հոսք, յուրաքանչյուր սեանսի 55%-ը ձերն է։',
          ru: 'Массажист с медицинским образованием. Стабильный поток клиентов, 55% с каждого сеанса — ваши.',
        },
        payType: 'percentage', salonPercent: 45,
        scheduleType: 'shift', scheduleNote: '09:00–15:00 / 15:00–21:00', experience: 'experienced',
        perks: ['client-base-provided', 'materials-included', 'uniform-provided', 'online-booking'],
        applyMode: 'both', contactPhone: '+374 10 50 60 70',
        state: 'published', publishedDaysAgo: 3, cover: 'spa', applicants: 3,
      },
      {
        specialtyKey: 'spa-therapy', location: 'komitas',
        description:
          'Spa therapist for body rituals and wraps. Fixed salary, an official contract and free use of the thermal zone.',
        descriptionI18n: {
          hy: 'Սպա թերապևտ՝ մարմնի ծեսերի և փաթաթումների համար։ Ֆիքսված աշխատավարձ, պաշտոնական պայմանագիր և ջերմային գոտու անվճար օգտագործում։',
          ru: 'Спа-терапевт для ритуалов и обёртываний. Фиксированная зарплата, официальное оформление и бесплатное посещение термальной зоны.',
        },
        payType: 'salary', amount: 250000, amountMax: 300000, payPeriod: 'month',
        scheduleType: 'full_time', experience: 'any',
        perks: ['official-contract', 'training-provided', 'meals'],
        applyMode: 'in_app',
        state: 'published', publishedDaysAgo: 8, applicants: 2,
      },
    ],
  },

  // ── 4b. Beauty Club Ohanyan (test) — branch & specialist pricing ─────
  // Every case the pricing model supports, in one tenant, so each screen can be
  // checked against a known answer. The real case behind the feature first:
  //   Hasmik — hair removal 5 000 at Kentron, 4 000 at Komitas (branch price);
  //   Anahit — the same service at Kentron for 7 000 (her own price).
  // Then the rest, one deliberate example each:
  //   · a specialist at 2 branches (Hasmik) and at 3 (Mariam), with different
  //     days at each — and one overlapping hour (Mariam, Saturday 15–16) that
  //     the Hours screen warns about
  //   · a service a branch does not offer (laser at Komitas, sauna at Kentron)
  //   · a service only one branch can do (Botox: only Anahit, only Kentron)
  //   · branch price, branch duration, branch range, branch "from X"
  //   · own price, own duration, own price on top of a branch price (Lilit),
  //     own fixed price for a range service (Anahit's facial)
  //   · hidden price with a branch override (still hidden from clients)
  //   · a facility service (sauna) with a per-branch price and capacity
  //   · a menu-only service nobody performs, an inactive service, an inactive
  //     specialist, time off, and one manager per branch
  {
    purpose:
      'BRANCH & SPECIALIST PRICING, every case — 3 branches; Hasmik hair removal 5 000 Kentron / 4 000 Komitas, Anahit 7 000; per-branch offered / price / duration / capacity, own prices, "from" prices, hidden price, sauna, menu-only service, Saturday overlap',
    slug: 'ohanyan-test',
    name: 'Beauty Club Ohanyan (Test)',
    nameI18n: { hy: 'Բյութի Քլաբ Օհանյան (թեստ)', ru: 'Бьюти Клаб Оганян (тест)' },
    type: 'Beauty club',
    typeI18n: { hy: 'Գեղեցկության ակումբ', ru: 'Клуб красоты' },
    kind: 'salon',
    template: 'classic',
    supportWidget: 'book',
    defaultLocale: 'hy',
    accent: '#B5487A',
    autoConfirmBookings: false,
    marketplaceListed: true,
    createdDaysAgo: 90,
    products: [{ key: 'bookings' }],
    branchPricing: true,
    presentation: {
      tagline: 'Kentron, Komitas and Nor Nork — book where it suits you',
      taglineI18n: {
        hy: 'Կենտրոն, Կոմիտաս և Նոր Նորք՝ ամրագրեք որտեղ ձեզ հարմար է',
        ru: 'Кентрон, Комитас и Нор-Норк — записывайтесь, где вам удобно',
      },
      about:
        'Beauty Club Ohanyan cares for your skin, nails and brows at three branches across Yerevan. Some of our masters work at more than one branch, and prices can differ by branch and by master — pick a branch to see exactly what you will pay.',
      aboutI18n: {
        hy: 'Բյութի Քլաբ Օհանյանը խնամում է ձեր մաշկը, եղունգները և հոնքերը Երևանի երեք մասնաճյուղերում։ Մեր որոշ վարպետներ աշխատում են մեկից ավելի մասնաճյուղում, և գները կարող են տարբերվել ըստ մասնաճյուղի և վարպետի․ ընտրեք մասնաճյուղը՝ տեսնելու, թե ինչքան կվճարեք։',
        ru: 'Бьюти Клаб Оганян заботится о вашей коже, ногтях и бровях в трёх филиалах Еревана. Часть мастеров работает в нескольких филиалах, а цены могут отличаться по филиалу и мастеру — выберите филиал, чтобы увидеть точную стоимость.',
      },
      hours: 'Daily · 10:00–21:00',
      instagram: 'https://instagram.com/reserva.am',
      whatsapp: '37491700700',
      heroTints: ['#B5487A', '#6E2347'],
      logo: { text: 'O', style: 'serif' },
      gallery: [
        { label: 'Kentron studio', motif: 'room' },
        { label: 'Komitas lounge', motif: 'lounge' },
        { label: 'Nor Nork reception', motif: 'reception' },
        { label: 'Treatment room', motif: 'detail' },
      ],
      works: [
        { label: 'Laser hair removal', motif: 'skin' },
        { label: 'Gel manicure', motif: 'nails', beforeAfter: true },
        { label: 'Facial cleansing', motif: 'skin', beforeAfter: true },
        { label: 'Brow shaping', motif: 'lashes' },
      ],
    },
    locations: [
      {
        key: 'kentron', name: 'Kentron', nameI18n: { hy: 'Կենտրոն', ru: 'Кентрон' },
        address: '9 Tumanyan St, Yerevan', phone: '+374 10 70 07 01',
        areaKey: 'yerevan-kentron', lat: 40.1847, lng: 44.5149,
        hours: daily('10:00', '20:00'),
      },
      {
        // Open seven days, and later than the others.
        key: 'komitas', name: 'Komitas', nameI18n: { hy: 'Կոմիտաս', ru: 'Комитас' },
        address: '35 Komitas Ave, Yerevan', phone: '+374 10 70 07 02',
        areaKey: 'yerevan-arabkir', lat: 40.2077, lng: 44.5069,
        hours: daily('10:00', '21:00', ALL_DAYS),
      },
      {
        // Closed Sunday AND Monday.
        key: 'nornork', name: 'Nor Nork', nameI18n: { hy: 'Նոր Նորք', ru: 'Нор-Норк' },
        address: '12 Gai Ave, Yerevan', phone: '+374 10 70 07 03',
        areaKey: 'yerevan-nor-nork', lat: 40.199, lng: 44.559,
        hours: daily('11:00', '19:00', ['tue', 'wed', 'thu', 'fri', 'sat']),
      },
    ],
    services: [
      { key: 'hair', name: 'Hair removal', nameI18n: { hy: 'Մազահեռացում', ru: 'Удаление волос' }, category: 'Epilation', categoryI18n: { hy: 'Էպիլյացիա', ru: 'Эпиляция' }, price: 5000, duration: 30, repeatEveryDays: 30 },
      { key: 'laser', name: 'Laser hair removal — full legs', nameI18n: { hy: 'Լազերային մազահեռացում — ոտքեր', ru: 'Лазерная эпиляция — ноги' }, category: 'Epilation', categoryI18n: { hy: 'Էպիլյացիա', ru: 'Эпиляция' }, price: 25000, duration: 60, repeatEveryDays: 42 },
      { key: 'mani', name: 'Manicure', nameI18n: { hy: 'Մատնահարդարում', ru: 'Маникюр' }, category: 'Nails', categoryI18n: CAT.nails, price: 8000, duration: 60, repeatEveryDays: 21 },
      { key: 'gel', name: 'Gel polish manicure', nameI18n: { hy: 'Գել-լաքով մատնահարդարում', ru: 'Маникюр с гель-лаком' }, category: 'Nails', categoryI18n: CAT.nails, price: 12000, duration: 90, repeatEveryDays: 21 },
      { key: 'brow', name: 'Brow shaping', nameI18n: { hy: 'Հոնքերի ձևավորում', ru: 'Коррекция бровей' }, category: 'Brows', categoryI18n: CAT.brows, price: 4000, duration: 30, repeatEveryDays: 28 },
      { key: 'facial', name: 'Facial cleansing', nameI18n: { hy: 'Դեմքի մաքրում', ru: 'Чистка лица' }, category: 'Facial care', categoryI18n: CAT.facial, price: 15000, priceMax: 25000, duration: 60 },
      { key: 'peel', name: 'Chemical peel', nameI18n: { hy: 'Քիմիական պիլինգ', ru: 'Химический пилинг' }, category: 'Facial care', categoryI18n: CAT.facial, price: 12000, duration: 45 },
      { key: 'botox', name: 'Botox — forehead', nameI18n: { hy: 'Բոտոքս — ճակատ', ru: 'Ботокс — лоб' }, category: 'Injections', categoryI18n: CAT.injections, price: 60000, hidePrice: true, duration: 30 },
      { key: 'sauna', name: 'Infrared sauna', nameI18n: { hy: 'Ինֆրակարմիր սաունա', ru: 'Инфракрасная сауна' }, category: 'Spa zone', categoryI18n: CAT.spaZone, price: 6000, duration: 60, capacity: 6 },
      // Nobody is linked to it: listed with its price, nothing to book.
      { key: 'consult', name: 'Skin consultation', nameI18n: { hy: 'Մաշկի խորհրդատվություն', ru: 'Консультация по коже' }, category: 'Consultations', categoryI18n: CAT.consult, price: 3000, duration: 20 },
      { key: 'paraffin', name: 'Paraffin hand mask', nameI18n: { hy: 'Պարաֆինային դիմակ ձեռքերի համար', ru: 'Парафиновая маска для рук' }, category: 'Nails', categoryI18n: CAT.nails, price: 3000, duration: 20, active: false },
    ],
    specialists: [
      {
        // Two branches on alternating days.
        key: 'hasmik', name: 'Hasmik Sahakyan', nameI18n: { hy: 'Հասմիկ Սահակյան', ru: 'Асмик Саакян' },
        title: 'Hair removal specialist', titleI18n: { hy: 'Մազահեռացման մասնագետ', ru: 'Специалист по удалению волос' },
        location: 'kentron', phone: '+37491700711', schedule: daily('10:00', '19:00', ['mon', 'wed', 'fri']),
        alsoAt: [{ location: 'komitas', schedule: daily('10:00', '19:00', ['tue', 'thu', 'sat']) }],
        services: ['hair', 'laser', 'brow', 'peel'], avatar: true, reviews: 8,
        timeOff: [
          { day: 2, from: '14:00', to: '17:00', reason: 'Doctor’s appointment' },
          { day: 12, days: 2, reason: 'Vacation' },
        ],
      },
      {
        key: 'anahit', name: 'Anahit Grigoryan', nameI18n: { hy: 'Անահիտ Գրիգորյան', ru: 'Анаит Григорян' },
        title: 'Senior cosmetologist', titleI18n: { hy: 'Ավագ կոսմետոլոգ', ru: 'Старший косметолог' },
        location: 'kentron', phone: '+37491700712', schedule: daily('10:00', '19:00'),
        services: ['hair', 'laser', 'facial', 'peel', 'botox'], avatar: true, reviews: 11,
      },
      {
        // Three branches; Saturday at Komitas (12–16) and Kentron (15–20) overlap by an hour.
        key: 'mariam', name: 'Mariam Hovhannisyan', nameI18n: { hy: 'Մարիամ Հովհաննիսյան', ru: 'Мариам Ованнисян' },
        title: 'Nail & brow master', titleI18n: { hy: 'Եղունգների և հոնքերի վարպետ', ru: 'Мастер маникюра и бровей' },
        location: 'komitas', phone: '+37491700713',
        schedule: week({ mon: ['10:00', '14:00'], wed: ['10:00', '14:00'], sat: ['12:00', '16:00'] }),
        alsoAt: [
          { location: 'nornork', schedule: daily('11:00', '19:00', ['tue', 'thu']) },
          { location: 'kentron', schedule: week({ sat: ['15:00', '20:00'] }) },
        ],
        services: ['mani', 'gel', 'brow'], avatar: true, reviews: 5,
      },
      {
        key: 'lilit', name: 'Lilit Hakobyan', nameI18n: { hy: 'Լիլիթ Հակոբյան', ru: 'Лилит Акопян' },
        title: 'Top nail artist', titleI18n: { hy: 'Առաջատար մատնահարդար', ru: 'Топ-мастер маникюра' },
        location: 'komitas', phone: '+37491700714', schedule: daily('11:00', '21:00', ['tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
        services: ['mani', 'gel', 'paraffin'], avatar: true, reviews: 6,
      },
      {
        // No portrait: the initials fallback.
        key: 'sona', name: 'Sona Avetisyan', nameI18n: { hy: 'Սոնա Ավետիսյան', ru: 'Сона Аветисян' },
        title: 'Cosmetologist', titleI18n: { hy: 'Կոսմետոլոգ', ru: 'Косметолог' },
        location: 'nornork', phone: '+37491700715', schedule: daily('11:00', '19:00', ['tue', 'wed', 'thu', 'fri', 'sat']),
        services: ['hair', 'facial', 'peel', 'brow'], avatar: false, reviews: 3,
      },
      {
        key: 'gayane', name: 'Gayane Petrosyan', nameI18n: { hy: 'Գայանե Պետրոսյան', ru: 'Гаянэ Петросян' },
        title: 'Hair removal specialist', titleI18n: { hy: 'Մազահեռացման մասնագետ', ru: 'Специалист по удалению волос' },
        location: 'kentron', phone: '+37491700716', schedule: daily('10:00', '19:00'),
        services: ['hair'], active: false, avatar: false,
      },
    ],
    branchPrices: [
      // Komitas: cheaper hair removal and nails, no laser machine, the big sauna.
      { location: 'komitas', service: 'hair', price: 4000 },
      { location: 'komitas', service: 'mani', price: 7000 },
      { location: 'komitas', service: 'gel', price: 11000 },
      { location: 'komitas', service: 'laser', offered: false },
      { location: 'komitas', service: 'sauna', price: 7000, capacity: 10 },
      // Kentron: no sauna; Botox costs more here (clients still see no price).
      { location: 'kentron', service: 'sauna', offered: false },
      { location: 'kentron', service: 'botox', price: 65000 },
      // Nor Nork: a longer manicure, its own facial range, peel "from 10 000".
      { location: 'nornork', service: 'mani', duration: 75 },
      { location: 'nornork', service: 'facial', price: 18000, priceMax: 28000 },
      { location: 'nornork', service: 'peel', price: 10000, priceType: 'range' },
    ],
    specialistPrices: [
      // Anahit (senior) at Kentron: dearer and longer hair removal, dearer
      // laser, and one fixed facial price instead of the 15 000–25 000 range.
      { specialist: 'anahit', location: 'kentron', service: 'hair', price: 7000, duration: 45 },
      { specialist: 'anahit', location: 'kentron', service: 'laser', price: 30000 },
      { specialist: 'anahit', location: 'kentron', service: 'facial', price: 20000, priceType: 'fixed' },
      // Hasmik: cheaper brows, but only at Komitas.
      { specialist: 'hasmik', location: 'komitas', service: 'brow', price: 3500 },
      // Lilit charges above the Komitas gel price (Mariam there pays the branch's 11 000).
      { specialist: 'lilit', location: 'komitas', service: 'gel', price: 13000 },
      // Mariam: same gel price at Nor Nork, but 2 hours instead of 1.5.
      { specialist: 'mariam', location: 'nornork', service: 'gel', duration: 120 },
    ],
    users: [
      { name: 'Lusine Avagyan', email: 'admin@ohanyan-test.am', phone: '+37491700700', role: 'admin', lastSeenHoursAgo: 1 },
      { name: 'Narine Mkrtchyan', email: 'kentron@ohanyan-test.am', phone: '+37491700701', role: 'manager', location: 'kentron', lastSeenHoursAgo: 5 },
      { name: 'Karine Sargsyan', email: 'komitas@ohanyan-test.am', phone: '+37491700702', role: 'manager', location: 'komitas', lastSeenHoursAgo: 20 },
      { name: 'Tatevik Harutyunyan', email: 'nornork@ohanyan-test.am', phone: '+37491700703', role: 'manager', location: 'nornork', lastSeenHoursAgo: 48 },
    ],
    bookings: { fromDay: -21, toDay: 14, perDay: [1, 3], facilityPerDay: [1, 3], publicShare: 0.6, clients: 26 },
  },

  // ── 5. Gohar Nails — the full solo professional ─────────────
  {
    purpose: 'FULL SOLO — single pro with one location + specialist (as signup provisions it), reviews, portfolio, a course',
    slug: 'gohar',
    name: 'Gohar Nails',
    nameI18n: { hy: 'Գոհար Նեյլս', ru: 'Гоар Нейлс' },
    type: 'Nail artist',
    typeI18n: { hy: 'Մատնահարդար', ru: 'Мастер маникюра' },
    kind: 'single',
    template: 'classic',
    supportWidget: 'support',
    defaultLocale: 'hy',
    accent: '#C2410C',
    autoConfirmBookings: true,
    marketplaceListed: true,
    createdDaysAgo: 60,
    products: [{ key: 'bookings' }, { key: 'courses', byStaff: true }],
    presentation: {
      tagline: 'Clean, long-lasting manicure in a cosy home studio',
      taglineI18n: {
        hy: 'Մաքուր և երկարատև մատնահարդարում հարմարավետ տնային ստուդիայում',
        ru: 'Чистый и стойкий маникюр в уютной домашней студии',
      },
      about:
        'Hi, I am Gohar! I have been doing nails for eight years and I work alone, so every appointment gets my full attention. Sterile tools, premium gel polishes and a cup of good coffee are always included.',
      aboutI18n: {
        hy: 'Բարև, ես Գոհարն եմ։ Ութ տարի է՝ զբաղվում եմ մատնահարդարմամբ և աշխատում եմ միայնակ, այնպես որ յուրաքանչյուր այցի ժամանակ իմ ամբողջ ուշադրությունը ձեզ է։ Ստերիլ գործիքներ, պրեմիում գել-լաքեր և մի բաժակ լավ սուրճ՝ միշտ։',
        ru: 'Привет, я Гоар! Восемь лет занимаюсь маникюром и работаю одна, поэтому на каждом приёме всё моё внимание — вам. Стерильные инструменты, премиальные гель-лаки и чашка хорошего кофе — всегда.',
      },
      hours: 'Mon–Sat · 10:00–19:00',
      instagram: 'https://instagram.com/reserva.am',
      whatsapp: '37477123456',
      heroTints: ['#C2410C', '#7C2D12'],
      logo: { text: 'G', style: 'serif' },
      gallery: [
        { label: 'My studio', motif: 'mirror' },
        { label: 'Workspace', motif: 'room' },
        { label: 'Polish collection', motif: 'detail' },
      ],
      works: [
        { label: 'Gel manicure', motif: 'nails', beforeAfter: true },
        { label: 'Autumn design', motif: 'nails' },
        { label: 'Gel extensions', motif: 'nails', beforeAfter: true },
        { label: 'Classic red', motif: 'nails' },
      ],
    },
    // Named after the business, exactly as SignupService provisions a solo's address.
    locations: [
      {
        key: 'home', name: 'Gohar Nails', address: '7 Kievyan St, Yerevan', phone: '+374 77 12 34 56',
        areaKey: 'yerevan-arabkir', lat: 40.1995, lng: 44.4935, hours: SOLO_DEFAULT,
      },
    ],
    services: [
      { key: 'classic', name: 'Classic manicure', nameI18n: { hy: 'Դասական մատնահարդարում', ru: 'Классический маникюр' }, category: 'Manicure', categoryI18n: CAT.manicure, price: 7000, duration: 60, repeatEveryDays: 21 },
      { key: 'gel', name: 'Manicure + gel polish', nameI18n: { hy: 'Մատնահարդարում + գել-լաք', ru: 'Маникюр + гель-лак' }, category: 'Manicure', categoryI18n: CAT.manicure, price: 10000, duration: 90, repeatEveryDays: 21 },
      { key: 'ext', name: 'Gel extensions', nameI18n: { hy: 'Եղունգների երկարացում գելով', ru: 'Наращивание ногтей гелем' }, category: 'Manicure', categoryI18n: CAT.manicure, price: 15000, duration: 150, repeatEveryDays: 21 },
      { key: 'spa', name: 'Spa manicure', nameI18n: { hy: 'Սպա մատնահարդարում', ru: 'Спа-маникюр' }, category: 'Manicure', categoryI18n: CAT.manicure, price: 9000, duration: 80 },
      { key: 'pedi', name: 'Pedicure + gel polish', nameI18n: { hy: 'Ոտնահարդարում + գել-լաք', ru: 'Педикюр + гель-лак' }, category: 'Pedicure', categoryI18n: CAT.pedicure, price: 12000, duration: 90, repeatEveryDays: 28 },
      { key: 'design', name: 'Nail design', nameI18n: { hy: 'Եղունգների դիզայն', ru: 'Дизайн ногтей' }, category: 'Extras', categoryI18n: CAT.extras, price: 1000, priceMax: 5000, duration: 20 },
      { key: 'removal', name: 'Gel removal', nameI18n: { hy: 'Գել-լաքի հեռացում', ru: 'Снятие гель-лака' }, category: 'Extras', categoryI18n: CAT.extras, price: 2000, duration: 20 },
    ],
    specialists: [
      {
        key: 'gohar', name: 'Gohar Manukyan', nameI18n: { hy: 'Գոհար Մանուկյան', ru: 'Гоар Манукян' },
        title: 'Nail artist', titleI18n: { hy: 'Մատնահարդար', ru: 'Мастер маникюра' },
        location: 'home', phone: '+37477123456', schedule: SOLO_DEFAULT,
        services: 'all', avatar: true, reviews: 18,
        timeOff: [{ day: 6, days: 1, reason: 'Personal day' }],
      },
    ],
    users: [{ name: 'Gohar Manukyan', email: 'admin@gohar.am', phone: '+37477123456', role: 'admin', lastSeenHoursAgo: 2 }],
    bookings: { fromDay: -28, toDay: 14, perDay: [2, 5], publicShare: 0.8, clients: 22 },
    courses: [
      {
        title: 'Manicure for beginners',
        titleI18n: { hy: 'Մատնահարդարում սկսնակների համար', ru: 'Маникюр для начинающих' },
        summary: 'One-on-one or in pairs, four Saturdays, all materials included.',
        summaryI18n: {
          hy: 'Անհատական կամ զույգերով, չորս շաբաթ օր, բոլոր նյութերը ներառված են։',
          ru: 'Индивидуально или в паре, четыре субботы, все материалы включены.',
        },
        description:
          'From hygiene to your first gel manicure on a model. Small groups of up to four people, so I can correct every movement.',
        descriptionI18n: {
          hy: 'Հիգիենայից մինչև ձեր առաջին գել մատնահարդարումը մոդելի վրա։ Փոքր խմբեր՝ մինչև չորս հոգի, որպեսզի կարողանամ ուղղել յուրաքանչյուր շարժում։',
          ru: 'От гигиены до вашего первого маникюра с гель-лаком на модели. Маленькие группы до четырёх человек, чтобы я могла поправить каждое движение.',
        },
        priceMode: 'paid',
        price: 90000,
        level: 'beginner',
        tutor: { specialist: 'gohar' },
        active: true,
        cover: 'nails',
        createdDaysAgo: 50,
        current: {
          status: 'open', location: 'home', startInDays: 14, lengthDays: 21,
          scheduleText: 'Sat · 11:00–15:00 (4 weeks)', capacity: 4, registrationOpen: true,
          members: [
            { status: 'confirmed', source: 'backoffice', daysAgo: 6 },
            { status: 'confirmed', source: 'public', daysAgo: 3 },
            { status: 'pending', source: 'public', daysAgo: 0 },
          ],
        },
        history: [
          {
            status: 'archived', location: 'home', startInDays: -45, lengthDays: 21,
            scheduleText: 'Sat · 11:00–15:00 (4 weeks)', capacity: 4, registrationOpen: false,
            members: [
              { status: 'completed', source: 'public', daysAgo: 55 },
              { status: 'completed', source: 'public', daysAgo: 53 },
              { status: 'completed', source: 'backoffice', daysAgo: 50 },
              { status: 'cancelled', source: 'public', daysAgo: 49 },
            ],
          },
        ],
      },
    ],
    support: {
      status: 'open',
      messages: [
        { from: 'platform', text: 'Welcome to Reserva, Gohar! Your page is live. Tip: add a few more works to your portfolio — pages with photos get noticeably more bookings.', minutesAgo: 60 * 24 * 2, read: false },
      ],
    },
  },

  // ── 6. Davit Barber — a brand-new solo, almost empty ────────
  {
    purpose: 'MINIMAL SOLO — just signed up: no logo/photos, no address or area yet, not listed in the marketplace',
    slug: 'davit-barber',
    name: 'Davit Barber',
    nameI18n: { hy: 'Դավիթ Բարբեր', ru: 'Давид Барбер' },
    type: 'Barber',
    typeI18n: { hy: 'Բարբեր', ru: 'Барбер' },
    kind: 'single',
    template: 'tabbed',
    supportWidget: 'book',
    defaultLocale: 'hy',
    accent: '#1D4ED8',
    marketplaceListed: false,
    createdDaysAgo: 12,
    products: [{ key: 'bookings' }],
    presentation: {
      tagline: 'Fades and beards, by appointment',
      taglineI18n: { hy: 'Ֆեյդեր և մորուքներ՝ նախնական գրանցմամբ', ru: 'Фейды и бороды — по записи' },
    },
    locations: [{ key: 'home', name: 'Davit Barber', address: '', phone: '+37498765432', areaKey: null, hours: null }],
    services: [
      { key: 'cut', name: 'Haircut', nameI18n: { hy: 'Սանրվածք', ru: 'Стрижка' }, category: '', price: 5000, duration: 40 },
      { key: 'beard', name: 'Beard', nameI18n: { hy: 'Մորուք', ru: 'Борода' }, category: '', price: 3000, duration: 20 },
      { key: 'combo', name: 'Haircut + beard', nameI18n: { hy: 'Սանրվածք + մորուք', ru: 'Стрижка + борода' }, category: '', price: 7000, duration: 60 },
    ],
    specialists: [
      {
        key: 'davit', name: 'Davit Hakobyan', title: 'Barber',
        location: 'home', phone: '+37498765432', schedule: SOLO_DEFAULT,
        services: 'all', avatar: false, reviews: 1,
      },
    ],
    users: [{ name: 'Davit Hakobyan', email: 'admin@davit-barber.am', phone: '+37498765432', role: 'admin', lastSeenHoursAgo: 72 }],
    bookings: { fromDay: -10, toDay: 7, perDay: [0, 2], publicShare: 0.5, clients: 8 },
  },

  // ── 7. Mane Hair Studio — contact-only mode ─────────────────
  {
    purpose: 'CONTACT-ONLY salon — bookingsEnabled = false: services shown, booking buttons replaced by call / WhatsApp',
    slug: 'mane',
    name: 'Mane Hair Studio',
    nameI18n: { hy: 'Մանե Հեր Ստուդիո', ru: 'Мане Хэйр Студио' },
    type: 'Hair salon',
    typeI18n: { hy: 'Վարսահարդարման սրահ', ru: 'Парикмахерская' },
    kind: 'salon',
    template: 'classic',
    supportWidget: 'support',
    defaultLocale: 'hy',
    accent: '#7C3AED',
    bookingsEnabled: false,
    marketplaceListed: true,
    createdDaysAgo: 45,
    products: [{ key: 'bookings' }],
    presentation: {
      tagline: 'Colour, cuts and keratin — call us to book',
      taglineI18n: { hy: 'Ներկում, սանրվածքներ և կերատին — գրանցվեք զանգով', ru: 'Окрашивание, стрижки и кератин — запись по телефону' },
      about:
        'A small, friendly hair studio in Malatia. We take bookings by phone and WhatsApp, so we can talk about your hair before the visit.',
      aboutI18n: {
        hy: 'Փոքր և ջերմ վարսահարդարման ստուդիա Մալաթիայում։ Գրանցումն ընդունում ենք հեռախոսով և WhatsApp-ով, որպեսզի այցից առաջ քննարկենք ձեր մազերը։',
        ru: 'Небольшая уютная студия в Малатии. Записываем по телефону и в WhatsApp, чтобы обсудить ваши волосы до визита.',
      },
      hours: 'Tue–Sun · 10:00–20:00',
      instagram: 'https://instagram.com/reserva.am',
      facebook: 'https://facebook.com/reserva.am',
      whatsapp: '37495112233',
      heroTints: ['#7C3AED', '#4C1D95'],
      logo: { text: 'M', style: 'serif' },
      gallery: [
        { label: 'Salon', motif: 'room' },
        { label: 'Colour bar', motif: 'mirror' },
      ],
      works: [
        { label: 'Balayage', motif: 'hair', beforeAfter: true },
        { label: 'Violet toning', motif: 'hair' },
      ],
    },
    locations: [
      {
        key: 'malatia', name: 'Malatia', nameI18n: { hy: 'Մալաթիա', ru: 'Малатия' },
        address: '3 Sebastia St, Yerevan', phone: '+374 95 11 22 33',
        areaKey: 'yerevan-malatia-sebastia', lat: 40.1718, lng: 44.4562,
        hours: daily('10:00', '20:00', ['tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
      },
    ],
    services: [
      { key: 'women-cut', name: "Women's haircut", nameI18n: { hy: 'Կանացի սանրվածք', ru: 'Женская стрижка' }, category: 'Cuts', categoryI18n: CAT.cuts, price: 9000, duration: 60 },
      { key: 'men-cut', name: "Men's haircut", nameI18n: { hy: 'Տղամարդու սանրվածք', ru: 'Мужская стрижка' }, category: 'Cuts', categoryI18n: CAT.cuts, price: 5000, duration: 40 },
      { key: 'blowdry', name: 'Blow-dry & styling', nameI18n: { hy: 'Ֆենով հարդարում', ru: 'Укладка феном' }, category: 'Styling', categoryI18n: CAT.styling, price: 6000, duration: 45 },
      { key: 'colour', name: 'Hair colouring', nameI18n: { hy: 'Մազերի ներկում', ru: 'Окрашивание волос' }, category: 'Colour', categoryI18n: CAT.colour, price: 18000, priceMax: 45000, duration: 150 },
      { key: 'balayage', name: 'Balayage', nameI18n: { hy: 'Բալայաժ', ru: 'Балаяж' }, category: 'Colour', categoryI18n: CAT.colour, price: 35000, priceMax: 70000, duration: 210 },
      { key: 'keratin', name: 'Keratin treatment', nameI18n: { hy: 'Կերատինային վերականգնում', ru: 'Кератиновое восстановление' }, category: 'Care', categoryI18n: CAT.care, price: 25000, priceMax: 60000, duration: 180, hidePrice: true },
      { key: 'bridal', name: 'Bridal hairstyle', nameI18n: { hy: 'Հարսանեկան սանրվածք', ru: 'Свадебная причёска' }, category: 'Styling', categoryI18n: CAT.styling, price: 30000, duration: 120, hidePrice: true },
    ],
    specialists: [
      {
        key: 'mane', name: 'Mane Abrahamyan', nameI18n: { hy: 'Մանե Աբրահամյան', ru: 'Мане Абраамян' },
        title: 'Stylist & owner', titleI18n: { hy: 'Ստիլիստ և սեփականատեր', ru: 'Стилист и владелица' },
        location: 'malatia', phone: '+37495112233', schedule: daily('10:00', '20:00', ['tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
        services: 'all', avatar: true, reviews: 7,
      },
      {
        key: 'tatevik', name: 'Tatevik Harutyunyan', nameI18n: { hy: 'Տաթևիկ Հարությունյան', ru: 'Татевик Арутюнян' },
        title: 'Colorist', titleI18n: { hy: 'Կոլորիստ', ru: 'Колорист' },
        location: 'malatia', phone: '+37495445566', schedule: daily('11:00', '20:00', ['wed', 'thu', 'fri', 'sat', 'sun']),
        services: ['colour', 'balayage', 'keratin', 'blowdry'], avatar: true, reviews: 5,
      },
    ],
    users: [{ name: 'Mane Abrahamyan', email: 'admin@mane.am', phone: '+37495112233', role: 'admin', lastSeenHoursAgo: 12 }],
    // Phone bookings only — the public flow is switched off.
    bookings: { fromDay: -14, toDay: 10, perDay: [1, 3], publicShare: 0, clients: 14 },
  },

  // ── 8. Old Town Beauty — deactivated ────────────────────────
  {
    purpose: 'DEACTIVATED partner (active = false) — public page 404, off the marketplace, history still visible in the internal console',
    slug: 'oldtown',
    name: 'Old Town Beauty',
    type: 'Beauty salon',
    typeI18n: { hy: 'Գեղեցկության սրահ', ru: 'Салон красоты' },
    kind: 'salon',
    accent: '#64748B',
    active: false,
    marketplaceListed: false,
    createdDaysAgo: 300,
    products: [{ key: 'bookings' }],
    presentation: {
      tagline: 'Classic beauty salon in Gyumri',
      taglineI18n: { hy: 'Դասական գեղեցկության սրահ Գյումրիում', ru: 'Классический салон красоты в Гюмри' },
      hours: 'Mon–Sat · 10:00–18:00',
      heroTints: ['#64748B', '#334155'],
    },
    locations: [
      {
        key: 'gyumri', name: 'Gyumri', nameI18n: { hy: 'Գյումրի', ru: 'Гюмри' },
        address: '10 Rizhkov St, Gyumri', phone: '+374 312 5 44 33',
        areaKey: 'gyumri', lat: 40.7894, lng: 43.8475, hours: daily('10:00', '18:00'),
      },
    ],
    services: [
      { key: 'cut', name: 'Haircut', nameI18n: { hy: 'Սանրվածք', ru: 'Стрижка' }, category: 'Hair', categoryI18n: CAT.hair, price: 4000, duration: 45 },
      { key: 'mani', name: 'Manicure', nameI18n: { hy: 'Մատնահարդարում', ru: 'Маникюр' }, category: 'Nails', categoryI18n: CAT.nails, price: 5000, duration: 60 },
      { key: 'brows', name: 'Brow shaping', nameI18n: { hy: 'Հոնքերի ձևավորում', ru: 'Коррекция бровей' }, category: 'Brows', categoryI18n: CAT.brows, price: 3000, duration: 30 },
    ],
    specialists: [
      {
        key: 'hasmik', name: 'Hasmik Vardanyan', nameI18n: { hy: 'Հասմիկ Վարդանյան', ru: 'Асмик Варданян' },
        title: 'Hairdresser', titleI18n: { hy: 'Վարսահարդար', ru: 'Парикмахер' },
        location: 'gyumri', phone: '+37443223344', schedule: daily('10:00', '18:00'),
        services: 'all', avatar: false, reviews: 2,
      },
    ],
    users: [{ name: 'Hasmik Vardanyan', email: 'admin@oldtown.am', phone: '+37443223344', role: 'admin', lastSeenHoursAgo: 24 * 70 }],
    bookings: { fromDay: -95, toDay: -62, perDay: [0, 2], publicShare: 0.4, clients: 8 },
  },

  // ── 9. Glamour Beauty Hall — vacancies only, on a trial ─────
  {
    purpose: 'VACANCIES-ONLY salon (signed up on the vacancies site) — no booking product, TRIAL grant, branch in Gyumri, no slug',
    slug: null,
    name: 'Glamour Beauty Hall',
    nameI18n: { hy: 'Գլամուր Բյուտի Հոլ', ru: 'Гламур Бьюти Холл' },
    type: 'Beauty salon',
    typeI18n: { hy: 'Գեղեցկության սրահ', ru: 'Салон красоты' },
    kind: 'salon',
    accent: '#DB2777',
    createdDaysAgo: 9,
    products: [{ key: 'vacancies', status: 'trialing', trialDays: 21 }],
    presentation: {},
    locations: [
      {
        key: 'center', name: 'Gyumri — Center', nameI18n: { hy: 'Գյումրի — Կենտրոն', ru: 'Гюмри — Центр' },
        address: '25 Abovyan St, Gyumri', phone: '+374 44 55 66 77',
        areaKey: 'gyumri', lat: 40.7856, lng: 43.8413, hours: daily('10:00', '19:00'),
      },
    ],
    users: [{ name: 'Lusine Tadevosyan', email: 'admin@glamour.am', phone: '+37444556677', role: 'admin', lastSeenHoursAgo: 6 }],
    vacancies: [
      {
        specialtyKey: 'hair-styling', location: 'center', seats: 2,
        description: 'Hairstylist for a new salon in the centre of Gyumri. A full client book from day one.',
        descriptionI18n: {
          hy: 'Վարսահարդար Գյումրու կենտրոնում նոր սրահի համար։ Հաճախորդներ՝ առաջին իսկ օրվանից։',
          ru: 'Парикмахер-стилист в новый салон в центре Гюмри. Клиенты с первого дня.',
        },
        payType: 'percentage', salonPercent: 40,
        scheduleType: 'full_time', experience: 'experienced',
        perks: ['client-base-provided', 'materials-included', 'training-provided'],
        applyMode: 'both', contactPhone: '+374 44 55 66 77',
        state: 'published', publishedDaysAgo: 5, cover: 'hair', applicants: 3,
      },
      {
        specialtyKey: 'manicure', location: 'center',
        title: 'Nail table for rent',
        titleI18n: { hy: 'Մատնահարդարման սեղան վարձով', ru: 'Аренда маникюрного стола' },
        description: 'Nail table for rent in a busy salon. Bring your clients — we provide the rest.',
        descriptionI18n: {
          hy: 'Մատնահարդարման սեղան վարձով զբաղված սրահում։ Բերեք ձեր հաճախորդներին, մնացածը՝ մեզնից։',
          ru: 'Аренда маникюрного стола в загруженном салоне. Приводите своих клиентов — остальное за нами.',
        },
        payType: 'rent', amount: 80000, payPeriod: 'month',
        scheduleType: 'flexible', experience: 'experienced',
        perks: ['own-client-base', 'parking', 'online-booking'],
        applyMode: 'phone', contactPhone: '+374 44 55 66 77',
        state: 'published', publishedDaysAgo: 7, applicants: 1,
      },
      {
        specialtyKey: 'makeup', location: 'center',
        title: 'Wedding makeup artist',
        titleI18n: { hy: 'Հարսանեկան դիմահարդար', ru: 'Свадебный визажист' },
        description: 'Makeup artist for weddings and events, mostly on weekends. Terms by agreement.',
        descriptionI18n: {
          hy: 'Դիմահարդար հարսանիքների և միջոցառումների համար, հիմնականում հանգստյան օրերին։ Պայմանները՝ համաձայնությամբ։',
          ru: 'Визажист на свадьбы и мероприятия, в основном по выходным. Условия по договорённости.',
        },
        payType: 'negotiable', scheduleType: 'part_time', experience: 'any',
        perks: ['flexible-schedule', 'own-tools'],
        applyMode: 'both', contactPhone: '+374 44 55 66 77',
        state: 'published', publishedDaysAgo: 1, applicants: 0,
      },
      {
        specialtyKey: 'administration', location: 'center',
        description: 'Front desk administrator for the new salon.',
        descriptionI18n: {
          hy: 'Ընդունարանի ադմինիստրատոր նոր սրահի համար։',
          ru: 'Администратор ресепшена в новый салон.',
        },
        payType: 'salary', amount: 150000, payPeriod: 'month',
        scheduleType: 'full_time', experience: 'any',
        perks: ['official-contract'],
        applyMode: 'in_app',
        state: 'draft', applicants: 0,
      },
    ],
  },

  // ── 10. Narine Beauty Room — vacancies-only solo ────────────
  {
    purpose: 'VACANCIES-ONLY SOLO — an address but no bookable specialist (as signup does for vacancies), renting out a table; no slug',
    slug: null,
    name: 'Narine Beauty Room',
    type: 'Lash artist',
    typeI18n: { hy: 'Թարթիչների մասնագետ', ru: 'Лешмейкер' },
    kind: 'single',
    accent: '#0EA5E9',
    createdDaysAgo: 18,
    products: [{ key: 'vacancies' }],
    presentation: {},
    locations: [
      {
        key: 'home', name: 'Narine Beauty Room', address: '9 Aram Khachatryan St, Yerevan', phone: '+374 33 99 88 77',
        areaKey: 'yerevan-nor-nork', lat: 40.1953, lng: 44.5615, hours: null,
      },
    ],
    users: [{ name: 'Narine Grigoryan', email: 'admin@narine.am', phone: '+37433998877', role: 'admin', lastSeenHoursAgo: 28 }],
    vacancies: [
      {
        specialtyKey: 'brow-design', location: 'home',
        title: 'Second table for a brow artist',
        titleI18n: { hy: 'Երկրորդ սեղան հոնքերի մասնագետի համար', ru: 'Второй стол для бровиста' },
        description:
          'I am a lash artist renting out the second table in my bright room in Nor Nork. Ideal for a brow artist with their own clients — and we can share clients too.',
        descriptionI18n: {
          hy: 'Ես թարթիչների մասնագետ եմ և վարձով եմ տալիս իմ լուսավոր սենյակի երկրորդ սեղանը Նոր Նորքում։ Իդեալական է սեփական հաճախորդներ ունեցող հոնքերի մասնագետի համար, իսկ հաճախորդներով կարող ենք նաև կիսվել։',
          ru: 'Я лешмейкер и сдаю второй стол в своём светлом кабинете в Нор-Норке. Идеально для бровиста со своими клиентами — а ещё мы можем делиться клиентами.',
        },
        payType: 'rent', amount: 5000, payPeriod: 'day',
        scheduleType: 'flexible', experience: 'experienced',
        perks: ['tools-provided', 'flexible-schedule', 'own-client-base'],
        applyMode: 'both', contactPhone: '+374 33 99 88 77',
        state: 'published', publishedDaysAgo: 10, applicants: 2,
      },
    ],
  },
];

// ── Platform side ─────────────────────────────────────────────

/** Internal-backoffice accounts (password: the shared demo password). */
export const PLATFORM_STAFF = [
  { name: 'Reserva Owner', email: 'owner@reserva.am', role: 'owner' as const, lastLoginHoursAgo: 1 },
  { name: 'Ani Karapetyan', email: 'operator@reserva.am', role: 'operator' as const, lastLoginHoursAgo: 26 },
];

/** Self-serve signups that never clicked their link (internal console → Pending registrations). */
export const PENDING_SIGNUPS = [
  {
    companyName: 'Beauty Point', companyType: 'Beauty salon', slug: 'beauty-point', accent: '#F59E0B',
    kind: 'salon' as const, product: 'bookings',
    adminName: 'Mariam Hakobyan', adminEmail: 'mariam.hakobyan@beautypoint.example', adminPhone: '+37491556677',
    createdHoursAgo: 5, expiresInHours: 19,
  },
  {
    companyName: 'Ara Barber', companyType: 'Barber', slug: '', accent: '#0F766E',
    kind: 'single' as const, product: 'vacancies',
    adminName: 'Ara Mkrtchyan', adminEmail: 'ara.mkrtchyan@example.com', adminPhone: '+37493667788',
    // Link already lapsed — staff can still activate it from the console.
    createdHoursAgo: 50, expiresInHours: -26,
  },
];
