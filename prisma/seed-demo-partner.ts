/**
 * Demo fixture: one partner exercising EVERY product and every branch of the
 * domain, so the whole backoffice can be walked without hunting for a real
 * account that happens to have the right data.
 *
 * What it deliberately covers:
 *   · all three products granted, so the product switcher has something to switch
 *   · two branches — one with OVERNIGHT hours (closes 02:30), the case that
 *     broke availability before
 *   · a facility service with no specialist (capacity-based), alongside fixed
 *     and range-priced ones
 *   · bookings in every status, from both sources, across past / today / future
 *   · a course with a running cohort and members in several states
 *   · vacancies covering all four pay types AND all five lifecycle states,
 *     including one already expired
 *   · hy + ru translations on everything a partner can translate
 *
 * SAFETY — this is runnable against production, so:
 *   · it is ADDITIVE by default. Nothing is ever deleted unless --reset is
 *     passed explicitly, and even then only rows belonging to THIS partner.
 *   · it refuses to touch a partner that already holds data unless --reset.
 *   · it checks that email, phone and slug are free before writing anything,
 *     so it can never collide with a real salon.
 *   · against a non-local database it refuses to run without --yes.
 *   · it verifies the product catalog and specialty taxonomy exist first, so
 *     running it before the migrations are deployed fails with a clear message
 *     rather than a foreign-key error halfway through.
 *
 * Local:
 *   pnpm exec ts-node -r tsconfig-paths/register prisma/seed-demo-partner.ts --reset
 *
 * Production:
 *   pnpm exec ts-node -r tsconfig-paths/register prisma/seed-demo-partner.ts  *     --yes  *     --email=reserva.platform+test@gmail.com  *     --password='Ab123456!'  *     --slug=reserva-showcase  *     --name='Reserva Showcase'  *     --phone=37411000777
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { v7 as uuidv7 } from 'uuid';

const prisma = new PrismaClient();

// ── CLI ───────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, fallback: string) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const EMAIL = opt('email', 'vacancy@gmail.com').toLowerCase();
const PASSWORD = opt('password', 'Ab123456!');
const SLUG = opt('slug', 'vacancy-demo');
const PARTNER_NAME = opt('name', 'Vacancy Demo Studio');
/** Normalized (digits only) — Client/User identity is keyed on this shape. */
const ADMIN_PHONE = opt('phone', '37411000111').replace(/\D/g, '');
const RESET = flag('reset');
const CONFIRMED = flag('yes');

const id = () => uuidv7();

/**
 * The specialty keys this fixture references. Hoisted so preflight can confirm
 * the taxonomy is deployed before writing anything, and used as the type of
 * `Vac.specialtyKey` below so a new listing cannot quietly reference a key that
 * nothing checks for.
 */
const FIXTURE_SPECIALTIES = [
  'barbering',
  'hair-coloring',
  'manicure',
  'cosmetology',
  'administration',
  'lash-extensions',
  'other',
] as const;
type FixtureSpecialty = (typeof FIXTURE_SPECIALTIES)[number];


/** Midnight today, so every generated time is stable within a run. */
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const at = (dayOffset: number, hour: number, minute = 0) => {
  const d = startOfToday();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
};
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000);

const day = (start: string, end: string, enabled = true) => ({ enabled, start, end });
const WEEK = (start: string, end: string, sunday = false) => ({
  mon: day(start, end),
  tue: day(start, end),
  wed: day(start, end),
  thu: day(start, end),
  fri: day(start, end),
  sat: day(start, end),
  sun: day(start, end, sunday),
});

/** Stop with a readable reason instead of a stack trace. */
function refuse(message: string): never {
  console.error(`\nRefusing to seed:\n  ${message}\n`);
  process.exit(1);
}

/**
 * Everything that must be true BEFORE anything is written. Ordered cheapest
 * first, and each check explains how to fix it — a half-applied fixture in
 * production is far worse than a script that declined to start.
 */
async function preflight(): Promise<{ partnerId: string; isNew: boolean }> {
  const url = process.env.DATABASE_URL ?? '';
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const host = url.replace(/^.*@/, '').replace(/\?.*$/, '') || '(unknown)';

  if (!isLocal && !CONFIRMED) {
    refuse(
      `This is not a local database (${host}).` +
        `\n  Re-run with --yes if you really mean to seed it.`,
    );
  }

  // The fixture references product keys and specialty keys created by
  // migrations. Without them every insert would fail on a foreign key
  // somewhere in the middle, leaving a half-built partner behind.
  const products = await prisma.product.findMany({ select: { key: true } });
  const missingProducts = ['bookings', 'courses', 'vacancies'].filter(
    (k) => !products.some((p) => p.key === k),
  );
  if (missingProducts.length) {
    refuse(
      `The product catalog is missing: ${missingProducts.join(', ')}.` +
        `\n  Deploy the migrations to this database first (prisma migrate deploy).`,
    );
  }

  const known = await prisma.specialty.findMany({
    where: { key: { in: [...FIXTURE_SPECIALTIES] } },
    select: { key: true },
  });
  const missingSpecialties = FIXTURE_SPECIALTIES.filter((k) => !known.some((s) => s.key === k));
  if (missingSpecialties.length) {
    refuse(
      `The specialty taxonomy is missing: ${[...new Set(missingSpecialties)].join(', ')}.` +
        `\n  Deploy the migrations to this database first (prisma migrate deploy).`,
    );
  }

  const existing = await prisma.user.findUnique({
    where: { email: EMAIL },
    select: { partnerId: true },
  });

  if (existing) {
    // Someone else's account must never be rewritten by a demo seed.
    const owner = await prisma.partner.findUnique({
      where: { id: existing.partnerId },
      select: { name: true, slug: true },
    });
    const [bookings, services, vacancies] = await Promise.all([
      prisma.booking.count({ where: { partnerId: existing.partnerId } }),
      prisma.service.count({ where: { partnerId: existing.partnerId } }),
      prisma.vacancy.count({ where: { partnerId: existing.partnerId } }),
    ]);
    const populated = bookings + services + vacancies > 0;
    if (populated && !RESET) {
      refuse(
        `"${owner?.name ?? EMAIL}" already holds data ` +
          `(${services} services, ${bookings} bookings, ${vacancies} vacancies).` +
          `\n  Pass --reset to wipe and rebuild ONLY this partner, or use a different --email.`,
      );
    }
    return { partnerId: existing.partnerId, isNew: false };
  }

  // Brand new: every unique key it needs must be free, checked up front so the
  // run cannot fail halfway and leave a partner with no admin user.
  const [slugTaken, phoneTaken] = await Promise.all([
    prisma.partner.findUnique({ where: { slug: SLUG }, select: { id: true } }),
    prisma.user.findUnique({ where: { phone: ADMIN_PHONE }, select: { id: true } }),
  ]);
  if (slugTaken) refuse(`The slug "${SLUG}" is taken. Pass a different --slug.`);
  if (phoneTaken) refuse(`The phone "${ADMIN_PHONE}" is taken. Pass a different --phone.`);

  console.log(`database     : ${host}${isLocal ? ' (local)' : ''}`);
  return { partnerId: id(), isNew: true };
}

async function main() {
  const { partnerId, isNew } = await preflight();
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const existing = isNew ? null : { partnerId };

  if (!existing) {
    await prisma.partner.create({
      data: {
        id: partnerId,
        slug: SLUG,
        name: PARTNER_NAME,
        nameI18n: { hy: 'Վականսի Դեմո Ստուդիա', ru: 'Вакансия Демо Студия' },
        type: 'Beauty studio',
        typeI18n: { hy: 'Գեղեցկության ստուդիա', ru: 'Студия красоты' },
        kind: 'salon',
        accent: '#7c5cff',
        bookingsEnabled: true,
        autoConfirmBookings: false,
        coursesEnabled: true,
        presentation: { create: {} },
      },
    });
    await prisma.user.create({
      data: {
        id: id(),
        partnerId,
        name: `${PARTNER_NAME} Admin`,
        email: EMAIL,
        phone: ADMIN_PHONE,
        role: 'admin',
        locationId: null,
        passwordHash,
        mustChangePassword: false,
      },
    });
  } else {
    await prisma.user.update({ where: { email: EMAIL }, data: { passwordHash } });
    await prisma.partner.update({
      where: { id: partnerId },
      data: { bookingsEnabled: true, coursesEnabled: true, deletedAt: null, active: true },
    });
  }

  // Destructive rebuild — ONLY on --reset, and only rows belonging to this
  // partner. Order respects the foreign keys (children first).
  if (RESET) {
    await prisma.$transaction([
      prisma.booking.deleteMany({ where: { partnerId } }),
      prisma.courseEnrollment.deleteMany({ where: { partnerId } }),
      prisma.vacancy.deleteMany({ where: { partnerId } }),
      prisma.client.deleteMany({ where: { partnerId } }),
    ]);
    await prisma.courseCohort.deleteMany({ where: { partnerId } });
    await prisma.course.deleteMany({ where: { partnerId } });
    await prisma.specialistService.deleteMany({ where: { specialist: { partnerId } } });
    await prisma.specialist.deleteMany({ where: { partnerId } });
    await prisma.service.deleteMany({ where: { partnerId } });
    await prisma.location.deleteMany({ where: { partnerId } });
  }

  // ── Products: all three, so the switcher has something to switch ──
  for (const productKey of ['bookings', 'courses', 'vacancies']) {
    await prisma.partnerProduct.upsert({
      where: { partnerId_productKey: { partnerId, productKey } },
      create: { id: id(), partnerId, productKey, status: 'active' },
      update: { status: 'active', disabledAt: null },
    });
  }

  // ── Public page ───────────────────────────────────────────
  await prisma.partnerPresentation.upsert({
    where: { partnerId },
    create: { partnerId },
    update: {},
  });
  await prisma.partnerPresentation.update({
    where: { partnerId },
    data: {
      tagline: 'Hair, nails and skin in the heart of Yerevan',
      taglineI18n: {
        hy: 'Մազեր, եղունգներ և մաշկ՝ Երևանի սրտում',
        ru: 'Волосы, ногти и кожа в самом сердце Еревана',
      },
      about:
        'A studio built around a simple idea: the people who work here should want to stay. Two branches, twelve chairs, and a team that trains together every month.',
      aboutI18n: {
        hy: 'Ստուդիա, որը կառուցված է պարզ գաղափարի շուրջ՝ այստեղ աշխատողները պետք է ցանկանան մնալ։ Երկու մասնաճյուղ, տասներկու աթոռ և թիմ, որը ամեն ամիս սովորում է միասին։',
        ru: 'Студия, построенная вокруг простой идеи: людям, которые здесь работают, должно хотеться остаться. Два филиала, двенадцать кресел и команда, которая учится вместе каждый месяц.',
      },
      hours: 'Mon–Sat · 10:00–20:00',
      instagram: 'https://instagram.com/reserva.am',
      whatsapp: ADMIN_PHONE,
    },
  });

  // ── Branches ──────────────────────────────────────────────
  const arabkir = id();
  const kentron = id();
  await prisma.location.createMany({
    data: [
      {
        id: arabkir,
        partnerId,
        name: 'Arabkir',
        nameI18n: { hy: 'Արաբկիր', ru: 'Арабкир' },
        address: 'Komitas Ave 45, Yerevan',
        phone: '+374 11 000 111',
        lat: 40.2003,
        lng: 44.4948,
        hours: WEEK('10:00', '20:00'),
      },
      {
        id: kentron,
        partnerId,
        name: 'Kentron (late night)',
        nameI18n: { hy: 'Կենտրոն (գիշերային)', ru: 'Кентрон (ночной)' },
        address: 'Abovyan St 12, Yerevan',
        phone: '+374 11 000 222',
        lat: 40.1830,
        lng: 44.5152,
        // Closes at 02:30 the NEXT day — the overnight case.
        hours: WEEK('12:00', '02:30', true),
      },
    ],
  });

  // ── Services ──────────────────────────────────────────────
  type Svc = {
    key: string; name: string; hy: string; ru: string;
    cat: string; catHy: string; catRu: string;
    price: number; priceMax?: number; duration: number;
    facility?: boolean; capacity?: number;
  };
  const SERVICES: Svc[] = [
    { key: 'mens-cut', name: "Men's haircut", hy: 'Տղամարդու սանրվածք', ru: 'Мужская стрижка', cat: 'Hair', catHy: 'Մազեր', catRu: 'Волосы', price: 5000, duration: 45 },
    { key: 'beard', name: 'Beard trim', hy: 'Մորուքի ձևավորում', ru: 'Оформление бороды', cat: 'Hair', catHy: 'Մազեր', catRu: 'Волосы', price: 3000, duration: 30 },
    { key: 'womens-cut', name: "Women's haircut", hy: 'Կանացի սանրվածք', ru: 'Женская стрижка', cat: 'Hair', catHy: 'Մազեր', catRu: 'Волосы', price: 8000, duration: 60 },
    // Range-priced: the exact charge is captured when the booking completes.
    { key: 'coloring', name: 'Hair coloring', hy: 'Մազերի ներկում', ru: 'Окрашивание волос', cat: 'Hair', catHy: 'Մազեր', catRu: 'Волосы', price: 15000, priceMax: 40000, duration: 120 },
    { key: 'manicure', name: 'Classic manicure', hy: 'Դասական մատնահարդարում', ru: 'Классический маникюр', cat: 'Nails', catHy: 'Եղունգներ', catRu: 'Ногти', price: 6000, duration: 60 },
    { key: 'pedicure', name: 'Pedicure', hy: 'Ոտնահարդարում', ru: 'Педикюр', cat: 'Nails', catHy: 'Եղունգներ', catRu: 'Ногти', price: 9000, duration: 75 },
    { key: 'facial', name: 'Deep-cleansing facial', hy: 'Դեմքի խորը մաքրում', ru: 'Глубокая чистка лица', cat: 'Skin', catHy: 'Մաշկ', catRu: 'Кожа', price: 12000, duration: 90 },
    // Facility service: no specialist, several guests at once.
    { key: 'sauna', name: 'Sauna day pass', hy: 'Սաունայի օրական անցաթուղթ', ru: 'Дневной абонемент в сауну', cat: 'Spa', catHy: 'Սպա', catRu: 'СПА', price: 7000, duration: 120, facility: true, capacity: 6 },
  ];

  const serviceIds = new Map<string, string>();
  for (const [i, sv] of SERVICES.entries()) {
    const sid = id();
    serviceIds.set(sv.key, sid);
    await prisma.service.create({
      data: {
        id: sid,
        partnerId,
        name: sv.name,
        nameI18n: { hy: sv.hy, ru: sv.ru },
        category: sv.cat,
        categoryI18n: { hy: sv.catHy, ru: sv.catRu },
        priceType: sv.priceMax ? 'range' : 'fixed',
        price: sv.price,
        priceMax: sv.priceMax ?? null,
        duration: sv.duration,
        requiresSpecialist: !sv.facility,
        capacity: sv.capacity ?? 1,
        sortOrder: i,
        active: true,
      },
    });
  }

  // ── Specialists ───────────────────────────────────────────
  type Sp = {
    key: string; name: string; hy: string; ru: string;
    title: string; titleHy: string; titleRu: string;
    locationId: string; schedule: object; services: string[];
  };
  const SPECIALISTS: Sp[] = [
    {
      key: 'aram', name: 'Aram Petrosyan', hy: 'Արամ Պետրոսյան', ru: 'Арам Петросян',
      title: 'Barber', titleHy: 'Բարբեր', titleRu: 'Барбер',
      locationId: arabkir, schedule: WEEK('10:00', '19:00'),
      services: ['mens-cut', 'beard'],
    },
    {
      key: 'lilit', name: 'Lilit Grigoryan', hy: 'Լիլիթ Գրիգորյան', ru: 'Лилит Григорян',
      title: 'Colorist', titleHy: 'Կոլորիստ', titleRu: 'Колорист',
      locationId: arabkir, schedule: WEEK('11:00', '20:00'),
      services: ['womens-cut', 'coloring'],
    },
    {
      key: 'anna', name: 'Anna Sargsyan', hy: 'Աննա Սարգսյան', ru: 'Анна Саргсян',
      title: 'Manicurist', titleHy: 'Մատնահարդար', titleRu: 'Мастер маникюра',
      locationId: arabkir, schedule: WEEK('10:00', '18:00'),
      services: ['manicure', 'pedicure'],
    },
    {
      key: 'davit', name: 'Davit Hakobyan', hy: 'Դավիթ Հակոբյան', ru: 'Давид Акопян',
      title: 'Barber', titleHy: 'Բարբեր', titleRu: 'Барбер',
      // Works the late-night branch, so his day genuinely crosses midnight.
      locationId: kentron, schedule: WEEK('12:00', '02:30', true),
      services: ['mens-cut', 'beard', 'facial'],
    },
  ];

  const specialistIds = new Map<string, string>();
  for (const sp of SPECIALISTS) {
    const spid = id();
    specialistIds.set(sp.key, spid);
    await prisma.specialist.create({
      data: {
        id: spid,
        partnerId,
        locationId: sp.locationId,
        name: sp.name,
        nameI18n: { hy: sp.hy, ru: sp.ru },
        title: sp.title,
        titleI18n: { hy: sp.titleHy, ru: sp.titleRu },
        phone: '',
        active: true,
        schedule: sp.schedule as Prisma.InputJsonValue,
      },
    });
    await prisma.specialistService.createMany({
      data: sp.services.map((k) => ({ specialistId: spid, serviceId: serviceIds.get(k)! })),
    });
  }

  // ── Clients ───────────────────────────────────────────────
  const CLIENTS = [
    { name: 'Narek Avetisyan', phone: '37493111222' },
    { name: 'Mariam Khachatryan', phone: '37493222333' },
    { name: 'Gor Melkonyan', phone: '37493333444' },
    { name: 'Sona Harutyunyan', phone: '37493444555' },
    { name: 'Tigran Manukyan', phone: '37493555666' },
    { name: 'Elena Petrova', phone: '37493666777' },
  ];
  const clientIds = new Map<string, string>();
  for (const c of CLIENTS) {
    const cid = id();
    clientIds.set(c.phone, cid);
    await prisma.client.create({
      data: { id: cid, partnerId, name: c.name, phone: c.phone, email: '' },
    });
  }

  // ── Bookings: every status, both sources, past → future ───
  type Bk = {
    svc: string; sp: string | null; loc: string; client: number;
    day: number; hour: number; minute?: number;
    status: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'noshow';
    source: 'public' | 'backoffice';
    finalPrice?: number;
  };
  const BOOKINGS: Bk[] = [
    // Past — completed history (drives revenue + the dashboard).
    { svc: 'mens-cut', sp: 'aram', loc: arabkir, client: 0, day: -9, hour: 11, status: 'completed', source: 'public' },
    { svc: 'coloring', sp: 'lilit', loc: arabkir, client: 1, day: -7, hour: 14, status: 'completed', source: 'public', finalPrice: 28000 },
    { svc: 'manicure', sp: 'anna', loc: arabkir, client: 3, day: -6, hour: 12, status: 'completed', source: 'backoffice' },
    { svc: 'beard', sp: 'aram', loc: arabkir, client: 2, day: -5, hour: 16, status: 'cancelled', source: 'public' },
    { svc: 'womens-cut', sp: 'lilit', loc: arabkir, client: 5, day: -4, hour: 15, status: 'noshow', source: 'public' },
    { svc: 'mens-cut', sp: 'davit', loc: kentron, client: 4, day: -3, hour: 23, status: 'completed', source: 'public' },
    { svc: 'facial', sp: 'davit', loc: kentron, client: 1, day: -2, hour: 19, status: 'completed', source: 'backoffice' },
    // Today — what the calendar opens on.
    { svc: 'mens-cut', sp: 'aram', loc: arabkir, client: 0, day: 0, hour: 11, status: 'confirmed', source: 'public' },
    { svc: 'manicure', sp: 'anna', loc: arabkir, client: 3, day: 0, hour: 13, status: 'confirmed', source: 'backoffice' },
    { svc: 'coloring', sp: 'lilit', loc: arabkir, client: 1, day: 0, hour: 15, status: 'pending', source: 'public' },
    { svc: 'sauna', sp: null, loc: arabkir, client: 2, day: 0, hour: 17, status: 'confirmed', source: 'public' },
    // A booking that starts before midnight at the late-night branch.
    { svc: 'beard', sp: 'davit', loc: kentron, client: 4, day: 0, hour: 23, minute: 30, status: 'confirmed', source: 'public' },
    // Upcoming.
    { svc: 'womens-cut', sp: 'lilit', loc: arabkir, client: 5, day: 1, hour: 12, status: 'pending', source: 'public' },
    { svc: 'pedicure', sp: 'anna', loc: arabkir, client: 3, day: 1, hour: 14, status: 'confirmed', source: 'backoffice' },
    { svc: 'mens-cut', sp: 'aram', loc: arabkir, client: 2, day: 2, hour: 10, status: 'confirmed', source: 'public' },
    { svc: 'facial', sp: 'davit', loc: kentron, client: 1, day: 3, hour: 18, status: 'pending', source: 'public' },
    { svc: 'coloring', sp: 'lilit', loc: arabkir, client: 5, day: 4, hour: 13, status: 'confirmed', source: 'public' },
    { svc: 'manicure', sp: 'anna', loc: arabkir, client: 0, day: 6, hour: 11, status: 'confirmed', source: 'backoffice' },
  ];

  for (const b of BOOKINGS) {
    const svc = SERVICES.find((s) => s.key === b.svc)!;
    const start = at(b.day, b.hour, b.minute ?? 0);
    const c = CLIENTS[b.client];
    await prisma.booking.create({
      data: {
        id: id(),
        partnerId,
        locationId: b.loc,
        specialistId: b.sp ? specialistIds.get(b.sp)! : null,
        serviceId: serviceIds.get(b.svc)!,
        clientId: clientIds.get(c.phone)!,
        clientName: c.name,
        clientPhone: c.phone,
        startAt: start,
        endAt: new Date(start.getTime() + svc.duration * 60_000),
        status: b.status,
        source: b.source,
        locale: b.source === 'public' ? 'hy' : null,
        priceAtBooking: svc.price,
        priceMaxAtBooking: svc.priceMax ?? null,
        finalPrice: b.finalPrice ?? null,
      },
    });
  }

  // ── Courses ───────────────────────────────────────────────
  const courseA = id();
  const courseB = id();
  await prisma.course.create({
    data: {
      id: courseA,
      partnerId,
      title: 'Barbering from zero',
      titleI18n: { hy: 'Բարբերություն զրոյից', ru: 'Барберинг с нуля' },
      summary: 'Eight weeks, real clients from week three.',
      summaryI18n: {
        hy: 'Ութ շաբաթ, իրական հաճախորդներ երրորդ շաբաթից։',
        ru: 'Восемь недель, реальные клиенты с третьей недели.',
      },
      description:
        'A full beginner course: tools, clipper work, fades, beard shaping and how to hold a chair of your own. Graduates are first in line for our open chairs.',
      descriptionI18n: {
        hy: 'Ամբողջական սկսնակների դասընթաց՝ գործիքներ, մեքենայով աշխատանք, ֆեյդեր, մորուքի ձևավորում և ինչպես պահել սեփական աթոռը։ Շրջանավարտները առաջինն են մեր թափուր աթոռների հերթում։',
        ru: 'Полный курс для начинающих: инструменты, работа машинкой, фейды, оформление бороды и как держать собственное кресло. Выпускники первыми получают наши свободные кресла.',
      },
      priceMode: 'paid',
      price: 180000,
      level: 'beginner',
      tutorSpecialistId: specialistIds.get('aram')!,
      active: true,
    },
  });
  await prisma.course.create({
    data: {
      id: courseB,
      partnerId,
      title: 'Colour correction masterclass',
      titleI18n: { hy: 'Գույնի շտկման վարպետության դաս', ru: 'Мастер-класс по коррекции цвета' },
      summary: 'One intensive weekend for working colorists.',
      summaryI18n: {
        hy: 'Մեկ ինտենսիվ շաբաթավերջ գործող կոլորիստների համար։',
        ru: 'Один интенсивный уикенд для практикующих колористов.',
      },
      priceMode: 'hidden',
      price: 0,
      level: 'advanced',
      tutorName: 'Guest tutor — Ani M.',
      tutorTitle: 'Colour educator',
      active: true,
    },
  });

  const cohortA = id();
  const cohortB = id();
  await prisma.courseCohort.createMany({
    data: [
      {
        id: cohortA, courseId: courseA, partnerId, locationId: arabkir,
        startDate: daysFromNow(-14), endDate: daysFromNow(42),
        scheduleText: 'Tue & Thu · 18:00–20:00',
        capacity: 10, status: 'running', registrationOpen: false,
      },
      {
        id: cohortB, courseId: courseB, partnerId, locationId: kentron,
        startDate: daysFromNow(21), endDate: daysFromNow(22),
        scheduleText: 'Sat & Sun · 11:00–17:00',
        capacity: 8, status: 'open', registrationOpen: true,
      },
    ],
  });

  const ENROLLMENTS = [
    { cohortId: cohortA, name: 'Hayk Sargsyan', phone: '37493777888', status: 'confirmed' as const, source: 'public' as const },
    { cohortId: cohortA, name: 'Ruzanna Ohanyan', phone: '37493888999', status: 'confirmed' as const, source: 'backoffice' as const },
    { cohortId: cohortA, name: 'Vahe Danielyan', phone: '37493999000', status: 'completed' as const, source: 'public' as const },
    { cohortId: cohortB, name: 'Nune Baghdasaryan', phone: '37494111222', status: 'pending' as const, source: 'public' as const },
    { cohortId: cohortB, name: 'Karen Voskanyan', phone: '37494222333', status: 'cancelled' as const, source: 'public' as const },
  ];
  for (const e of ENROLLMENTS) {
    await prisma.courseEnrollment.create({
      data: {
        id: id(),
        cohortId: e.cohortId,
        partnerId,
        memberName: e.name,
        memberPhone: e.phone,
        memberEmail: '',
        status: e.status,
        source: e.source,
        priceAtEnroll: e.cohortId === cohortA ? 180000 : 0,
        locale: e.source === 'public' ? 'hy' : null,
      },
    });
  }

  // ── Vacancies: all four pay types × all five lifecycle states ──
  type Vac = {
    specialtyKey: FixtureSpecialty; loc: string; title?: string;
    payType: 'percentage' | 'rent' | 'salary' | 'negotiable';
    salonPercent?: number; salonPercentMax?: number;
    amount?: number; amountMax?: number;
    payPeriod?: 'day' | 'week' | 'month';
    status: 'draft' | 'published' | 'paused' | 'closed';
    expiresInDays?: number;
    seats?: number;
    scheduleType?: 'full_time' | 'part_time' | 'shift' | 'flexible';
    experience?: 'any' | 'junior' | 'experienced';
    perks: string[];
    applyMode?: 'in_app' | 'phone' | 'both';
    description: string; hy: string; ru: string;
  };
  const VACANCIES: Vac[] = [
    {
      specialtyKey: 'barbering', loc: arabkir, payType: 'rent', amount: 150000, payPeriod: 'month',
      status: 'published', expiresInDays: 27, seats: 2, scheduleType: 'shift', experience: 'experienced',
      perks: ['materials-included', 'own-client-base', 'parking', 'online-booking'],
      applyMode: 'both',
      description: 'A chair in a busy barbershop. You keep everything you earn; we keep the lights on, the towels clean and the bookings flowing.',
      hy: 'Աթոռ զբաղված բարբերշոփում։ Դուք պահում եք ձեր ամբողջ եկամուտը, մենք հոգում ենք մնացածը։',
      ru: 'Кресло в загруженном барбершопе. Вы забираете весь свой заработок, остальное — на нас.',
    },
    {
      specialtyKey: 'hair-coloring', loc: arabkir, payType: 'percentage', salonPercent: 40, salonPercentMax: 50,
      status: 'published', expiresInDays: 19, scheduleType: 'full_time', experience: 'experienced',
      perks: ['materials-included', 'training-provided', 'online-booking', 'official-contract'],
      applyMode: 'both',
      description: 'Colorist for a studio that actually buys good product. Split improves with your column.',
      hy: 'Կոլորիստ ստուդիայի համար, որը իսկապես գնում է լավ նյութեր։',
      ru: 'Колорист в студию, которая действительно покупает хороший продукт.',
    },
    {
      specialtyKey: 'manicure', loc: arabkir, payType: 'salary', amount: 220000, amountMax: 320000, payPeriod: 'month',
      status: 'published', expiresInDays: 4, scheduleType: 'full_time', experience: 'any',
      perks: ['official-contract', 'materials-included', 'meals', 'uniform-provided'],
      applyMode: 'in_app',
      description: 'Salaried manicurist, five days a week, paid holiday. Beginners welcome — we train.',
      hy: 'Աշխատավարձով մատնահարդար, շաբաթը հինգ օր, վճարովի արձակուրդ։',
      ru: 'Мастер маникюра на зарплате, пять дней в неделю, оплачиваемый отпуск.',
    },
    {
      specialtyKey: 'cosmetology', loc: kentron, payType: 'negotiable',
      status: 'draft', scheduleType: 'part_time', experience: 'experienced',
      perks: ['flexible-schedule', 'own-tools'],
      applyMode: 'phone',
      description: 'Cosmetologist for evening hours at the late-night branch. Terms by agreement.',
      hy: 'Կոսմետոլոգ գիշերային մասնաճյուղի երեկոյան ժամերի համար։ Պայմանները՝ պայմանագրային։',
      ru: 'Косметолог на вечерние часы в ночном филиале. Условия договорные.',
    },
    {
      specialtyKey: 'administration', loc: kentron, payType: 'salary', amount: 180000, payPeriod: 'month',
      status: 'paused', scheduleType: 'shift', experience: 'any',
      perks: ['official-contract', 'meals', 'transport'],
      applyMode: 'both',
      description: 'Front desk for the Kentron branch, 2/2 shifts including late nights.',
      hy: 'Ադմինիստրատոր Կենտրոն մասնաճյուղի համար, 2/2 գրաֆիկ։',
      ru: 'Администратор в филиал Кентрон, график 2/2, включая ночные смены.',
    },
    {
      specialtyKey: 'lash-extensions', loc: arabkir, payType: 'rent', amount: 6000, payPeriod: 'day',
      // Published but already out of time — the expired state, one click from live.
      status: 'published', expiresInDays: -3, experience: 'experienced',
      perks: ['own-client-base', 'own-tools', 'flexible-schedule'],
      applyMode: 'phone',
      description: 'Daily table rental for a lash artist with her own clients.',
      hy: 'Օրավարձով սեղան թարթիչների մասնագետի համար՝ սեփական հաճախորդներով։',
      ru: 'Посуточная аренда стола для лешмейкера со своей клиентской базой.',
    },
    {
      specialtyKey: 'other', loc: arabkir, title: 'Evening cleaner', payType: 'salary', amount: 90000, payPeriod: 'month',
      status: 'closed', scheduleType: 'part_time', experience: 'any',
      perks: ['transport'],
      applyMode: 'phone',
      description: 'Two hours every evening after closing. Position filled — kept for reference.',
      hy: 'Օրական երկու ժամ՝ փակվելուց հետո։ Տեղը զբաղված է։',
      ru: 'Два часа каждый вечер после закрытия. Позиция закрыта.',
    },
  ];

  for (const v of VACANCIES) {
    const published = v.status === 'published';
    await prisma.vacancy.create({
      data: {
        id: id(),
        partnerId,
        locationId: v.loc,
        specialtyKey: v.specialtyKey,
        title: v.title ?? '',
        description: v.description,
        descriptionI18n: { hy: v.hy, ru: v.ru },
        seats: v.seats ?? 1,
        payType: v.payType,
        salonPercent: v.salonPercent ?? null,
        salonPercentMax: v.salonPercentMax ?? null,
        amount: v.amount ?? null,
        amountMax: v.amountMax ?? null,
        payPeriod: v.payPeriod ?? 'month',
        scheduleType: v.scheduleType ?? null,
        scheduleNote: v.scheduleType === 'shift' ? '2/2 · 12:00–02:30' : '',
        experience: v.experience ?? 'any',
        perks: v.perks,
        applyMode: v.applyMode ?? 'both',
        contactPhone: v.applyMode === 'in_app' ? '' : '+374 11 000 111',
        status: v.status,
        publishedAt: v.status === 'draft' ? null : daysFromNow(-10),
        expiresAt: published ? daysFromNow(v.expiresInDays ?? 30) : null,
        closedAt: v.status === 'closed' ? daysFromNow(-1) : null,
      },
    });
  }

  // ── Report ────────────────────────────────────────────────
  const [locations, services, specialists, clients, bookings, courses, enrollments, vacancies, grants] =
    await Promise.all([
      prisma.location.count({ where: { partnerId, deletedAt: null } }),
      prisma.service.count({ where: { partnerId, deletedAt: null } }),
      prisma.specialist.count({ where: { partnerId, deletedAt: null } }),
      prisma.client.count({ where: { partnerId } }),
      prisma.booking.count({ where: { partnerId } }),
      prisma.course.count({ where: { partnerId, deletedAt: null } }),
      prisma.courseEnrollment.count({ where: { partnerId } }),
      prisma.vacancy.count({ where: { partnerId, deletedAt: null } }),
      prisma.partnerProduct.findMany({ where: { partnerId }, select: { productKey: true } }),
    ]);

  console.log('partner      :', partnerId);
  console.log('login        :', EMAIL, '/', PASSWORD);
  console.log('products     :', grants.map((g) => g.productKey).join(', '));
  console.log('branches     :', locations, '(one closes 02:30)');
  console.log('services     :', services, '(1 range-priced, 1 facility)');
  console.log('specialists  :', specialists);
  console.log('clients      :', clients);
  console.log('bookings     :', bookings, '(all statuses, both sources)');
  console.log('courses      :', courses, '/ enrollments:', enrollments);
  console.log('vacancies    :', vacancies, '(all pay types + all states)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
