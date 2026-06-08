/**
 * Seed script — ports the original frontend mock data into the database.
 * Idempotent: clears the seeded partners (by slug) and re-creates them.
 *
 * Run on the server with:  pnpm db:seed
 *
 * Demo logins after seeding (password: "demo1234" unless noted):
 *   admin@antheris.am   / demo1234   (admin, Antheris)
 *   manager@antheris.am / demo1234   (manager, Antheris · Arabkir)
 *   admin@barberbro.am  / demo1234   (admin, BarberBro)
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { v7 as uuidv7 } from 'uuid';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'demo1234';

// Default weekly hours used for locations + specialists in the seed.
const everyDay = (start: string, end: string): Prisma.InputJsonValue =>
  Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { enabled: true, start, end }]),
  );
const exceptSunday = (start: string, end: string): Prisma.InputJsonValue =>
  Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [
      d,
      { enabled: d !== 'sun', start, end },
    ]),
  );

interface SeedSpecialist {
  key: string;
  name: string;
  title: string;
  locationKey: string;
  active: boolean;
  phone: string;
  serviceKeys: string[];
}
interface SeedPartner {
  slug: string;
  name: string;
  type: string;
  accent: string;
  presentation: Prisma.PartnerPresentationCreateWithoutPartnerInput;
  locations: { key: string; name: string; address: string; phone: string; hours: Prisma.InputJsonValue }[];
  services: { key: string; name: string; price: number; duration: number; active: boolean; category: string }[];
  specialists: SeedSpecialist[];
  admin: { name: string; email: string; phone: string };
  managers?: { name: string; email: string; phone: string; locationKey: string }[];
}

const PARTNERS: SeedPartner[] = [
  {
    slug: 'antheris',
    name: 'Antheris',
    type: 'Aesthetic clinic',
    accent: '#E8456B',
    presentation: {
      tagline: 'Modern aesthetic medicine in the heart of Yerevan',
      about:
        'Antheris is a clinical aesthetics studio where science meets care. From laser treatments to bespoke facials, our specialists craft results-driven plans tailored to your skin — in a calm, considered space designed to make you feel at home.',
      hours: 'Mon–Sat · 10:00–19:00',
      rating: 4.9,
      reviews: 214,
      heroTints: ['#2C2C30', '#121214'],
      gallery: [
        { label: 'Treatment room', tone: '#2C2C30' },
        { label: 'Reception', tone: '#121214' },
        { label: 'Laser suite', tone: '#3C3C42' },
        { label: 'Lounge', tone: '#1E1E22' },
      ],
    },
    locations: [
      { key: 'arabkir', name: 'Arabkir', address: '34 Komitas Ave, Yerevan', phone: '+374 10 24 56 78', hours: everyDay('10:00', '19:00') },
      { key: 'kentron', name: 'Kentron', address: '12 Pushkin St, Yerevan', phone: '+374 10 53 11 02', hours: exceptSunday('10:00', '18:00') },
    ],
    services: [
      { key: 'laser-fl', name: 'Laser — full face', price: 18000, duration: 30, active: true, category: 'Laser' },
      { key: 'laser-leg', name: 'Laser — full legs', price: 35000, duration: 60, active: true, category: 'Laser' },
      { key: 'laser-bk', name: 'Laser — bikini', price: 22000, duration: 30, active: true, category: 'Laser' },
      { key: 'facial-im', name: 'Imsirun facial', price: 28000, duration: 75, active: true, category: 'Facial' },
      { key: 'derma', name: 'Dermatology consult', price: 15000, duration: 45, active: true, category: 'Medical' },
      { key: 'inject', name: 'Botox injection', price: 55000, duration: 30, active: true, category: 'Medical' },
    ],
    specialists: [
      { key: 's1', name: 'Anush Petrosyan', title: 'Lead aesthetician', locationKey: 'arabkir', active: true, phone: '+374 91 22 11 33', serviceKeys: ['laser-fl', 'laser-leg', 'facial-im', 'derma'] },
      { key: 's2', name: 'Mariam Sargsyan', title: 'Laser specialist', locationKey: 'arabkir', active: true, phone: '+374 91 88 12 44', serviceKeys: ['laser-fl', 'laser-leg', 'laser-bk'] },
      { key: 's3', name: 'Dr. Lilit Hovhannisyan', title: 'Dermatologist', locationKey: 'kentron', active: true, phone: '+374 91 09 88 21', serviceKeys: ['derma', 'inject'] },
      { key: 's4', name: 'Nare Avetisyan', title: 'Aesthetician', locationKey: 'kentron', active: false, phone: '+374 91 33 87 19', serviceKeys: ['facial-im'] },
    ],
    admin: { name: 'Armen Petrosyan', email: 'admin@antheris.am', phone: '+374 91 10 10 10' },
    managers: [{ name: 'Nare Avetisyan', email: 'manager@antheris.am', phone: '+374 91 20 20 20', locationKey: 'arabkir' }],
  },
  {
    slug: 'barberbro',
    name: 'BarberBro',
    type: 'Barbershop',
    accent: '#2F4A3A',
    presentation: {
      tagline: 'Sharp cuts, classic vibes, no appointments-by-DM',
      about:
        'BarberBro is where craft meets attitude. Walk in for a precise fade, a clean beard line-up, or the full combo — and walk out feeling like the best version of yourself. Booked online in seconds, finished in style.',
      hours: 'Tue–Sun · 11:00–20:00',
      rating: 4.8,
      reviews: 158,
      heroTints: ['#2F4A3A', '#1E3225'],
      gallery: [
        { label: 'The chair', tone: '#2F4A3A' },
        { label: 'Storefront', tone: '#1E3225' },
        { label: 'Tools', tone: '#46604F' },
        { label: 'Waiting area', tone: '#26402F' },
      ],
    },
    locations: [
      { key: 'mashtots', name: 'Mashtots', address: '22 Mashtots Ave, Yerevan', phone: '+374 10 44 22 11', hours: everyDay('11:00', '20:00') },
    ],
    services: [
      { key: 'cut', name: 'Haircut', price: 5000, duration: 30, active: true, category: 'Hair' },
      { key: 'beard', name: 'Beard trim', price: 3000, duration: 20, active: true, category: 'Beard' },
      { key: 'combo', name: 'Haircut + beard', price: 7000, duration: 50, active: true, category: 'Combo' },
      { key: 'fade', name: 'Fade cut', price: 6000, duration: 35, active: true, category: 'Hair' },
    ],
    specialists: [
      { key: 's1', name: 'Armen Grigoryan', title: 'Senior barber', locationKey: 'mashtots', active: true, phone: '+374 93 11 22 33', serviceKeys: ['cut', 'beard', 'combo'] },
      { key: 's2', name: 'Vardan Mkrtchyan', title: 'Barber', locationKey: 'mashtots', active: true, phone: '+374 93 44 55 66', serviceKeys: ['cut', 'beard', 'fade'] },
    ],
    admin: { name: 'Armen Grigoryan', email: 'admin@barberbro.am', phone: '+374 93 30 30 30' },
  },
  {
    slug: 'lume',
    name: 'Lumé Studio',
    type: 'Beauty studio',
    accent: '#B07683',
    presentation: {
      tagline: 'Soft glamour & flawless detail by the Cascade',
      about:
        'Lumé Studio is a haven for nails, lashes and brows — where every detail is finished to perfection. Our artists blend technique with a gentle touch, so you leave glowing and ready to be seen. Quietly luxurious, effortlessly you.',
      hours: 'Mon–Sat · 10:00–20:00',
      rating: 5.0,
      reviews: 96,
      heroTints: ['#B07683', '#7A4A55'],
      gallery: [
        { label: 'Nail bar', tone: '#B07683' },
        { label: 'Lash room', tone: '#7A4A55' },
        { label: 'Studio', tone: '#C99AA5' },
        { label: 'Entrance', tone: '#955E69' },
      ],
    },
    locations: [
      { key: 'cascade', name: 'Cascade', address: '5 Tamanyan St, Yerevan', phone: '+374 10 77 88 99', hours: exceptSunday('10:00', '20:00') },
    ],
    services: [
      { key: 'mani', name: 'Classic manicure', price: 8000, duration: 60, active: true, category: 'Nails' },
      { key: 'pedi', name: 'Classic pedicure', price: 10000, duration: 75, active: true, category: 'Nails' },
      { key: 'gel', name: 'Gel manicure', price: 12000, duration: 90, active: true, category: 'Nails' },
      { key: 'lash', name: 'Lash extensions', price: 25000, duration: 120, active: true, category: 'Lashes' },
      { key: 'brow', name: 'Brow shaping', price: 6000, duration: 30, active: true, category: 'Brows' },
    ],
    specialists: [
      { key: 's1', name: 'Naira Hovhannisyan', title: 'Nail artist', locationKey: 'cascade', active: true, phone: '+374 99 11 22 33', serviceKeys: ['mani', 'pedi', 'gel'] },
      { key: 's2', name: 'Silva Abrahamyan', title: 'Lash artist', locationKey: 'cascade', active: true, phone: '+374 99 44 55 66', serviceKeys: ['lash', 'brow'] },
    ],
    admin: { name: 'Naira Hovhannisyan', email: 'admin@lume.am', phone: '+374 99 30 30 30' },
  },
  {
    slug: 'avanta',
    name: 'Avanta',
    type: 'Wellness & spa',
    accent: '#1FA84C',
    presentation: {
      tagline: 'Restore, recharge, renew — naturally',
      about:
        'Avanta is a sanctuary for body and mind, where natural therapies meet expert hands. From deep-tissue massage to detoxifying body rituals, every treatment is designed to leave you lighter, calmer and renewed — green by name, restorative by nature.',
      hours: 'Mon–Sun · 09:00–21:00',
      rating: 4.9,
      reviews: 173,
      heroTints: ['#1FA84C', '#0E6B30'],
      gallery: [
        { label: 'Massage suite', tone: '#1FA84C' },
        { label: 'Relaxation lounge', tone: '#0E6B30' },
        { label: 'Steam room', tone: '#34BF63' },
        { label: 'Reception', tone: '#157A38' },
      ],
    },
    locations: [
      { key: 'northern', name: 'Northern Ave', address: '8 Northern Ave, Yerevan', phone: '+374 10 50 60 70', hours: everyDay('09:00', '21:00') },
      { key: 'komitas', name: 'Komitas', address: '41 Komitas Ave, Yerevan', phone: '+374 10 33 77 22', hours: everyDay('09:00', '21:00') },
    ],
    services: [
      { key: 'massage', name: 'Classic massage', price: 12000, duration: 60, active: true, category: 'Massage' },
      { key: 'deep', name: 'Deep tissue massage', price: 16000, duration: 75, active: true, category: 'Massage' },
      { key: 'hot', name: 'Hot stone massage', price: 18000, duration: 90, active: true, category: 'Massage' },
      { key: 'aroma', name: 'Aromatherapy', price: 14000, duration: 60, active: true, category: 'Therapy' },
      { key: 'body', name: 'Body scrub', price: 11000, duration: 45, active: true, category: 'Body' },
      { key: 'wrap', name: 'Detox body wrap', price: 20000, duration: 90, active: true, category: 'Body' },
    ],
    specialists: [
      { key: 's1', name: 'Gohar Davtyan', title: 'Lead therapist', locationKey: 'northern', active: true, phone: '+374 94 10 20 30', serviceKeys: ['massage', 'aroma', 'body'] },
      { key: 's2', name: 'Tigran Karapetyan', title: 'Massage therapist', locationKey: 'northern', active: true, phone: '+374 94 40 50 60', serviceKeys: ['massage', 'deep', 'hot'] },
      { key: 's3', name: 'Ani Melkonyan', title: 'Spa specialist', locationKey: 'komitas', active: true, phone: '+374 94 70 80 90', serviceKeys: ['aroma', 'body', 'wrap'] },
    ],
    admin: { name: 'Gohar Davtyan', email: 'admin@avanta.am', phone: '+374 94 30 30 30' },
  },
];

// Deterministic sample client names for generated bookings.
const CLIENT_POOL = [
  ['Maria Hakobyan', '+374 91 55 11 22'],
  ['David Asatryan', '+374 93 66 33 44'],
  ['Lilit Vardanyan', '+374 94 77 88 99'],
  ['Artak Hovhannisyan', '+374 96 88 99 00'],
  ['Sona Grigoryan', '+374 95 12 34 56'],
  ['Karen Sahakyan', '+374 98 21 43 65'],
];

function normalizePhone(raw: string): string {
  const plus = raw.trim().startsWith('+') ? '+' : '';
  return plus + raw.replace(/\D/g, '');
}

async function main() {
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  // ── Platform owner (internal-backoffice super admin) ──
  // Idempotent: upsert by email. Login: owner@reserva.am / demo1234
  await prisma.platformUser.upsert({
    where: { email: 'owner@reserva.am' },
    create: {
      id: uuidv7(),
      name: 'Platform Owner',
      email: 'owner@reserva.am',
      role: 'owner',
      passwordHash,
    },
    update: { passwordHash, role: 'owner', active: true, deletedAt: null },
  });

  for (const p of PARTNERS) {
    // Idempotency: remove any prior copy of this partner (cascades to children).
    await prisma.partner.deleteMany({ where: { slug: p.slug } });

    const partnerId = uuidv7();
    const locationIds: Record<string, string> = {};
    const serviceIds: Record<string, string> = {};

    await prisma.partner.create({
      data: {
        id: partnerId,
        slug: p.slug,
        name: p.name,
        type: p.type,
        accent: p.accent,
        presentation: { create: p.presentation },
      },
    });

    for (const loc of p.locations) {
      const id = uuidv7();
      locationIds[loc.key] = id;
      await prisma.location.create({
        data: { id, partnerId, name: loc.name, address: loc.address, phone: loc.phone, hours: loc.hours },
      });
    }

    for (const svc of p.services) {
      const id = uuidv7();
      serviceIds[svc.key] = id;
      await prisma.service.create({
        data: {
          id,
          partnerId,
          name: svc.name,
          price: svc.price,
          duration: svc.duration,
          active: svc.active,
          category: svc.category,
        },
      });
    }

    const specialistIds: Record<string, string> = {};
    for (const sp of p.specialists) {
      const id = uuidv7();
      specialistIds[sp.key] = id;
      await prisma.specialist.create({
        data: {
          id,
          partnerId,
          locationId: locationIds[sp.locationKey],
          name: sp.name,
          title: sp.title,
          phone: sp.phone,
          active: sp.active,
          schedule: everyDay('10:00', '19:00'),
          services: { create: sp.serviceKeys.map((k) => ({ serviceId: serviceIds[k] })) },
        },
      });
    }

    // Admin + managers.
    await prisma.user.create({
      data: {
        id: uuidv7(),
        partnerId,
        name: p.admin.name,
        email: p.admin.email.toLowerCase(),
        phone: normalizePhone(p.admin.phone),
        role: 'admin',
        locationId: null,
        passwordHash,
      },
    });
    for (const m of p.managers ?? []) {
      await prisma.user.create({
        data: {
          id: uuidv7(),
          partnerId,
          name: m.name,
          email: m.email.toLowerCase(),
          phone: normalizePhone(m.phone),
          role: 'manager',
          locationId: locationIds[m.locationKey],
          passwordHash,
        },
      });
    }

    // A handful of upcoming bookings across the active specialists.
    await seedBookings(partnerId, p, specialistIds, serviceIds, locationIds);

    console.log(`✓ Seeded ${p.name} (${p.slug})`);
  }

  console.log('\nDone. Demo login: admin@antheris.am / demo1234');
}

async function seedBookings(
  partnerId: string,
  p: SeedPartner,
  specialistIds: Record<string, string>,
  serviceIds: Record<string, string>,
  locationIds: Record<string, string>,
) {
  const activeSpecialists = p.specialists.filter((s) => s.active);
  let clientIdx = 0;

  for (let dayOffset = 0; dayOffset < 5; dayOffset++) {
    for (const sp of activeSpecialists) {
      // One booking per specialist per day, staggered by specialist index.
      const svcKey = sp.serviceKeys[0];
      const svc = p.services.find((s) => s.key === svcKey)!;
      const idx = activeSpecialists.indexOf(sp);

      const start = new Date();
      start.setDate(start.getDate() + dayOffset);
      start.setHours(11 + idx * 2, 0, 0, 0);
      const end = new Date(start.getTime() + svc.duration * 60_000);

      const [name, phone] = CLIENT_POOL[clientIdx % CLIENT_POOL.length];
      clientIdx++;
      const normPhone = normalizePhone(phone);

      const client = await prisma.client.upsert({
        where: { partnerId_phone: { partnerId, phone: normPhone } },
        create: { id: uuidv7(), partnerId, name, phone: normPhone },
        update: {},
      });

      await prisma.booking.create({
        data: {
          id: uuidv7(),
          partnerId,
          locationId: locationIds[sp.locationKey],
          specialistId: specialistIds[sp.key],
          serviceId: serviceIds[svcKey],
          clientId: client.id,
          clientName: name,
          clientPhone: normPhone,
          startAt: start,
          endAt: end,
          status: dayOffset === 0 ? 'confirmed' : 'pending',
          source: 'backoffice',
          priceAtBooking: svc.price,
        },
      });
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
