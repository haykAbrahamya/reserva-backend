/**
 * Seed demo professionals for the specialist directory.
 *
 *   pnpm run seed:professionals          # create (idempotent — reseeds cleanly)
 *   pnpm run seed:professionals:clean    # remove them again
 *
 * Everything it creates carries the marker below, and `--clean` removes exactly
 * what carries it — so a demo run can never take a real account with it. All of
 * them use +37455… numbers, a range nothing else in this project uses.
 *
 * The images are generated rather than downloaded: `sharp` is already a
 * dependency, the app has no network access in a seed, and a stock photo would
 * put someone's face in a test fixture. They are soft two-tone gradients at
 * real photo dimensions, which is what the card and gallery layouts actually
 * need to be judged against.
 */
import { PrismaClient } from '@prisma/client';
import { mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

/**
 * The phone prefix every seeded row carries, and the only thing `--clean`
 * matches on. Nothing else in this project uses +37455…, so a demo wipe can
 * never take a real account with it.
 */
const MARKER = '+37455';
const UPLOADS = resolve(process.env.UPLOADS_DIR || 'uploads');
const PUBLIC_BASE = process.env.UPLOADS_PUBLIC_URL || '/uploads';

interface Person {
  name: string;
  phone: string;
  years: number | null;
  about: string;
  /** How many portfolio photos to generate. Zero is a case worth having. */
  photos: number;
  /**
   * Set false for a profile with NO profile photo.
   *
   * Worth seeding deliberately: an empty avatar is the single most common state
   * of a real account — people register mid-application and never come back to
   * finish — and it is the state a card, a directory row and a public page are
   * most likely to look broken in. A fixture set where everyone has a photo
   * tests the easy half of the product.
   */
  avatar?: boolean;
  /** Whether they published a phone number. */
  contact: boolean;
  /** Whether the profile is public at all — two are not, to prove the filter. */
  published?: boolean;
  /** Hue pair for the generated imagery. */
  hue: [number, number];
  /** How many specialties to take from the catalog, and from where. */
  specialtyOffset: number;
  specialtyCount: number;
  areaOffset: number;
  areaCount: number;
}

const PEOPLE: Person[] = [
  { name: 'Անի Հակոբյան', phone: '+37455100001', years: 7, photos: 5, contact: true, hue: [280, 320],
    specialtyOffset: 0, specialtyCount: 2, areaOffset: 0, areaCount: 2,
    about: 'Վարսահարդար եմ՝ 7 տարվա փորձով։ Մասնագիտանում եմ գունավորման, բալայաժի և խնամքի մեջ։ Աշխատել եմ Երևանի մի քանի սրահներում, ունեմ իմ մշտական հաճախորդների բազան։' },
  { name: 'Մարիամ Սարգսյան', phone: '+37455100002', years: 3, photos: 4, contact: false, hue: [10, 40],
    specialtyOffset: 3, specialtyCount: 1, areaOffset: 1, areaCount: 1,
    about: 'Մատնահարդար։ Դասական և ապարատային մանիկյուր, գել-լաք, դիզայն։ Աշխատում եմ Կենտրոնում։' },
  { name: 'Դավիթ Գրիգորյան', phone: '+37455100003', years: 12, photos: 6, contact: true, hue: [200, 230],
    specialtyOffset: 5, specialtyCount: 2, areaOffset: 2, areaCount: 3,
    about: 'Բարբեր՝ 12 տարվա փորձով։ Դասական սանրվածքներ, ֆեյդ, մորուքի ձևավորում և խնամք։ Սովորեցնում եմ նաև սկսնակների։' },
  { name: 'Լիլիթ Ավետիսյան', phone: '+37455100004', years: 5, photos: 3, contact: true, hue: [330, 10],
    specialtyOffset: 8, specialtyCount: 2, areaOffset: 0, areaCount: 1,
    about: 'Կոսմետոլոգ։ Դեմքի մաքրում, պիլինգ, մեզոթերապիա։ Ունեմ բժշկական կրթություն և միջազգային սերտիֆիկատներ։' },
  { name: 'Նարեկ Պետրոսյան', phone: '+37455100005', years: 1, photos: 2, contact: false, hue: [150, 190],
    specialtyOffset: 5, specialtyCount: 1, areaOffset: 3, areaCount: 2,
    about: 'Սկսնակ բարբեր եմ, ավարտել եմ դասընթացը այս տարի։ Փնտրում եմ սրահ, որտեղ կարող եմ աճել։' },
  { name: 'Գայանե Մկրտչյան', phone: '+37455100006', years: 9, photos: 5, contact: true, hue: [260, 300],
    specialtyOffset: 0, specialtyCount: 3, areaOffset: 1, areaCount: 2,
    about: 'Կոլորիստ՝ 9 տարվա փորձով։ Բարդ գունավորումներ, շիկացում, վերականգնում։ Աշխատում եմ միայն պրոֆեսիոնալ ներկերով։' },
  { name: 'Սոնա Խաչատրյան', phone: '+37455100007', years: 4, photos: 0, contact: false, hue: [40, 70],
    specialtyOffset: 10, specialtyCount: 1, areaOffset: 0, areaCount: 1,
    about: 'Հոնքերի և թարթիչների մասնագետ։ Ճարտարապետություն, ներկում, լամինացիա։' },
  { name: 'Արմեն Հովհաննիսյան', phone: '+37455100008', years: 15, photos: 4, contact: true, hue: [210, 250],
    specialtyOffset: 5, specialtyCount: 2, areaOffset: 4, areaCount: 2,
    about: 'Տղամարդկանց վարսահարդար՝ 15 տարվա փորձով։ Աշխատել եմ Մոսկվայում և Երևանում։ Փնտրում եմ աթոռ վարձով։' },
  { name: 'Էլեն Բաղդասարյան', phone: '+37455100009', years: 2, photos: 3, contact: true, hue: [300, 340],
    specialtyOffset: 3, specialtyCount: 2, areaOffset: 2, areaCount: 1,
    about: 'Մատնահարդար և պեդիկյուր։ Հիգիենան առաջին տեղում է։ Կարող եմ աշխատել նաև հաճախորդի տանը։' },
  { name: 'Տիգրան Ղազարյան', phone: '+37455100010', years: 6, photos: 4, contact: false, hue: [180, 210],
    specialtyOffset: 8, specialtyCount: 1, areaOffset: 0, areaCount: 3,
    about: 'Մերսման մասնագետ։ Դասական, սպորտային և հակացելյուլիտային մերսում։ Ունեմ բժշկական կրթություն։' },
  { name: 'Անահիտ Մանուկյան', phone: '+37455100011', years: 11, photos: 6, contact: true, hue: [320, 350],
    specialtyOffset: 0, specialtyCount: 2, areaOffset: 1, areaCount: 1,
    about: 'Հարսանեկան սանրվածքներ և դիմահարդարում։ 11 տարի, հարյուրավոր հարսանիքներ։ Աշխատում եմ նաև լուսանկարչական նկարահանումների համար։' },
  { name: 'Վահե Սիմոնյան', phone: '+37455100012', years: null, photos: 2, contact: false, hue: [120, 160],
    specialtyOffset: 5, specialtyCount: 1, areaOffset: 5, areaCount: 1,
    about: 'Բարբեր։ Փորձս նշված չէ, բայց աշխատանքներս խոսում են իմ փոխարեն։' },
  { name: 'Քրիստինե Ասատրյան', phone: '+37455100013', years: 8, photos: 5, contact: true, hue: [270, 310],
    specialtyOffset: 8, specialtyCount: 2, areaOffset: 0, areaCount: 2,
    about: 'Կոսմետոլոգ-էսթետիստ։ Ապարատային կոսմետոլոգիա, ինյեկցիոն մեթոդներ, անհատական խնամքի ծրագրեր։' },
  // Two unpublished, so the directory's privacy rule is visible in the data
  // rather than only in a test.
  { name: 'Հասմիկ Ղուկասյան', phone: '+37455100014', years: 3, photos: 2, contact: false, published: false,
    hue: [30, 60], specialtyOffset: 3, specialtyCount: 1, areaOffset: 2, areaCount: 1,
    about: 'Դեռ չեմ հրապարակել իմ պրոֆիլը։' },
  { name: 'Ռուբեն Ավագյան', phone: '+37455100015', years: 20, photos: 0, contact: false, published: false,
    hue: [220, 260], specialtyOffset: 0, specialtyCount: 1, areaOffset: 0, areaCount: 1,
    about: 'Վարպետ՝ 20 տարվա փորձով։ Պրոֆիլը դեռ փակ է։' },

  // ── The unflattering half of the data ─────────────────────
  //
  // Everything below is published and deliberately incomplete. These are the
  // rows that decide whether the card, the directory grid and the public page
  // hold their shape — a fixture set where every profile is finished only ever
  // tests the layout that was easy to get right.

  // The floor: nothing but a name and a phone number. This is what an account
  // created mid-application actually looks like.
  { name: 'Արփինե Ս.', phone: '+37455100016', years: null, photos: 0, contact: false, avatar: false,
    hue: [0, 0], specialtyOffset: 0, specialtyCount: 0, areaOffset: 0, areaCount: 0, about: '' },

  // No face, but there is work to look at — the card's cover has photos while
  // its avatar falls back to an initial.
  { name: 'Գոռ Մարտիրոսյան', phone: '+37455100017', years: 4, photos: 3, contact: true, avatar: false,
    hue: [190, 220], specialtyOffset: 5, specialtyCount: 1, areaOffset: 1, areaCount: 1,
    about: 'Բարբեր եմ։ Նկար չեմ դրել, բայց աշխատանքներս կարող եք տեսնել։' },

  // A face and nothing else: no bio, no areas, no experience.
  { name: 'Նվարդ Ա.', phone: '+37455100018', years: null, photos: 0, contact: false,
    hue: [300, 330], specialtyOffset: 8, specialtyCount: 1, areaOffset: 0, areaCount: 0, about: '' },

  // A name long enough to test every truncation on the card and in the rail.
  { name: 'Մարիա-Անգելինա Հովհաննիսյան-Ղազարյան', phone: '+37455100019', years: 2, photos: 0,
    contact: false, avatar: false, hue: [40, 80], specialtyOffset: 3, specialtyCount: 1,
    areaOffset: 3, areaCount: 1, about: 'Կարճ։' },

  // The other extreme: the most of everything a profile is allowed to hold —
  // twelve specialties, twelve areas, a full-length bio, a full gallery.
  { name: 'Զարուհի Բարսեղյան', phone: '+37455100020', years: 25, photos: 6, contact: true,
    hue: [265, 305], specialtyOffset: 0, specialtyCount: 12, areaOffset: 0, areaCount: 12,
    about: 'Ունեմ 25 տարվա փորձ գեղեցկության ոլորտում և աշխատել եմ գրեթե բոլոր ուղղություններով՝ վարսահարդարում, գունավորում, մատնահարդարում, կոսմետոլոգիա, հարսանեկան դիմահարդարում և ոլորտի ուսուցում։ Վերջին տասը տարին ղեկավարել եմ սեփական սրահը Երևանի կենտրոնում, որտեղ պատրաստել եմ ավելի քան քառասուն մասնագետ։ Այժմ փնտրում եմ թիմ, որտեղ կարող եմ համատեղել վարպետի և մենթորի դերը՝ աշխատել հաճախորդների հետ և միաժամանակ սովորեցնել սկսնակներին։ Կարևորում եմ հիգիենան, ճշտապահությունը և հաճախորդի հետ երկարաժամկետ հարաբերությունը։' },
];

/** A soft two-tone gradient at real photo dimensions. */
async function image(w: number, h: number, [h1, h2]: [number, number], seed: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${h1} 45% ${58 + (seed % 3) * 6}%)"/>
        <stop offset="100%" stop-color="hsl(${h2} 40% ${30 + (seed % 4) * 5}%)"/>
      </linearGradient>
      <radialGradient id="v" cx="50%" cy="35%" r="70%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.22)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0.28)"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect width="100%" height="100%" fill="url(#v)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

async function store(proId: string, buf: Buffer, prefix: string): Promise<string> {
  const dir = join(UPLOADS, 'pro', proId);
  await mkdir(dir, { recursive: true });
  const file = `${prefix}-${randomUUID()}.webp`;
  await sharp(buf).webp({ quality: 82 }).toFile(join(dir, file));
  return `${PUBLIC_BASE}/pro/${proId}/${file}`;
}

async function clean() {
  const victims = await prisma.professional.findMany({
    where: { phone: { startsWith: MARKER } },
    select: { id: true, name: true },
  });
  for (const v of victims) {
    await prisma.professionalRefreshToken.deleteMany({ where: { professionalId: v.id } });
    await prisma.professional.delete({ where: { id: v.id } });
    await rm(join(UPLOADS, 'pro', v.id), { recursive: true, force: true });
  }
  console.log(`removed ${victims.length} demo professional(s)`);
}

async function seed() {
  // Start from a clean slate so re-running is idempotent rather than additive.
  await clean();

  const specialties = await prisma.specialty.findMany({ select: { key: true }, orderBy: { key: 'asc' } });
  const districts = await prisma.area.findMany({
    where: { parentKey: { not: null } },
    select: { key: true },
    orderBy: { key: 'asc' },
  });
  if (!specialties.length || !districts.length) {
    throw new Error('The specialty/area catalogs are empty — seed those first.');
  }

  // One shared hash for every demo account. Not a secret: these are fixtures,
  // and the password is printed below so they can actually be signed into.
  const { PasswordService } = await import('../src/auth/password.service');
  const passwords = new PasswordService();
  const passwordHash = await passwords.hash('testpassword1');

  const pick = <T,>(list: T[], offset: number, count: number): T[] =>
    Array.from({ length: count }, (_, i) => list[(offset + i) % list.length]);

  for (const [i, p] of PEOPLE.entries()) {
    const id = randomUUID();

    // A missing photo is stored as an empty string, exactly as the column's
    // default and the UI's fallback expect — not as a grey placeholder image,
    // which would hide the very case this row exists to exercise.
    const avatarUrl = p.avatar === false ? '' : await store(id, await image(600, 600, p.hue, i), 'av');
    const photos: { url: string }[] = [];
    for (let n = 0; n < p.photos; n++) {
      photos.push({ url: await store(id, await image(900, 1200, p.hue, i + n + 1), 'ph') });
    }

    await prisma.professional.create({
      data: {
        id,
        name: p.name,
        phone: p.phone,
        email: null,
        passwordHash,
        specialtyKeys: pick(specialties, p.specialtyOffset, p.specialtyCount).map((s) => s.key),
        areaKeys: pick(districts, p.areaOffset, p.areaCount).map((a) => a.key),
        experienceYears: p.years,
        about: p.about,
        avatarUrl,
        photos,
        publicProfile: p.published !== false,
        showContact: p.contact,
        locale: 'hy',
      },
    });
    const flags = [
      p.avatar === false ? 'no-avatar' : null,
      p.photos === 0 ? 'no-photos' : null,
      !p.about ? 'no-bio' : null,
      p.specialtyCount === 0 ? 'no-specialty' : null,
      p.areaCount === 0 ? 'no-areas' : null,
      p.years === null ? 'no-years' : null,
      p.published === false ? 'unpublished' : null,
    ].filter(Boolean);
    console.log(
      `  ${p.phone}  ${p.name.slice(0, 24).padEnd(26)} photos=${String(p.photos).padEnd(2)}` +
        (flags.length ? ` [${flags.join(', ')}]` : ''),
    );
  }

  const published = await prisma.professional.count({ where: { publicProfile: true } });
  console.log(`\nseeded ${PEOPLE.length}; ${published} profile(s) now public`);
  console.log('sign in as any of them with password: testpassword1');
}

const main = process.argv.includes('--clean') ? clean : seed;
main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
