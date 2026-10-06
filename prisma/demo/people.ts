/**
 * The people the demo tenants deal with: customers, reviewers, course members
 * and job applicants.
 *
 * Mixed scripts on purpose — staff type names in Latin, Armenian and Cyrillic,
 * and search, sorting and truncation have to cope with all three. Phones are in
 * the exact shape `normalizePhone` produces ("+374…"), which is what the app
 * stores and what login-by-phone and client search compare against.
 *
 * None of these numbers use +37455…, which prisma/seed-professionals.ts owns.
 */

export interface Person {
  name: string;
  phone: string;
  email?: string;
  notes?: string;
}

/** Booking customers. Each tenant takes its own slice so client lists differ. */
export const CLIENTS: Person[] = [
  { name: 'Maria Hakobyan', phone: '+37491551122', email: 'maria.hakobyan@example.com', notes: 'Prefers morning appointments.' },
  { name: 'David Asatryan', phone: '+37493663344' },
  { name: 'Lilit Vardanyan', phone: '+37494778899', email: 'lilit.v@example.com' },
  { name: 'Artak Hovhannisyan', phone: '+37496889900' },
  { name: 'Sona Grigoryan', phone: '+37495123456', notes: 'Sensitive skin — patch test first.' },
  { name: 'Karen Sahakyan', phone: '+37498214365' },
  { name: 'Narek Avetisyan', phone: '+37493111222' },
  { name: 'Mariam Khachatryan', phone: '+37493222333', email: 'mariam.kh@example.com' },
  { name: 'Gor Melkonyan', phone: '+37493333444' },
  { name: 'Sona Harutyunyan', phone: '+37493444555' },
  { name: 'Tigran Manukyan', phone: '+37493555666', notes: 'Always books with the same specialist.' },
  { name: 'Elena Petrova', phone: '+37493666777', email: 'elena.petrova@example.com' },
  { name: 'Anahit Simonyan', phone: '+37491234501' },
  { name: 'Armine Karapetyan', phone: '+37491234502', email: 'armine.k@example.com' },
  { name: 'Hasmik Martirosyan', phone: '+37491234503' },
  { name: 'Meri Ghukasyan', phone: '+37491234504', notes: 'Allergic to latex gloves.' },
  { name: 'Lusine Mirzoyan', phone: '+37491234505' },
  { name: 'Ani Baghdasaryan', phone: '+37491234506' },
  { name: 'Ruzanna Ohanyan', phone: '+37491234507', email: 'ruzanna.o@example.com' },
  { name: 'Gayane Sargsyan', phone: '+37491234508' },
  { name: 'Nune Avagyan', phone: '+37491234509' },
  { name: 'Tatevik Asatryan', phone: '+37491234510', notes: 'VIP — offer tea on arrival.' },
  { name: 'Arpi Hambardzumyan', phone: '+37491234511' },
  { name: 'Inna Sokolova', phone: '+37491234512', email: 'inna.sokolova@example.com' },
  { name: 'Olga Ivanova', phone: '+37491234513' },
  { name: 'Natalia Smirnova', phone: '+37491234514' },
  { name: 'Vahe Danielyan', phone: '+37491234515' },
  { name: 'Arman Poghosyan', phone: '+37491234516' },
  { name: 'Hovhannes Gevorgyan', phone: '+37491234517' },
  { name: 'Samvel Arakelyan', phone: '+37491234518' },
  { name: 'Erik Mnatsakanyan', phone: '+37491234519' },
  { name: 'Robert Hakobjanyan', phone: '+37491234520' },
  { name: 'Անի Գևորգյան', phone: '+37477112233' },
  { name: 'Արմեն Սահակյան', phone: '+37477223344' },
  { name: 'Մարինե Պողոսյան', phone: '+37477334455', notes: 'Զանգահարել նախորդ օրը հիշեցման համար։' },
  { name: 'Սյուզաննա Վարդանյան', phone: '+37477445566' },
  { name: 'Գոռ Մելիքյան', phone: '+37477556677' },
  { name: 'Ирина Кузнецова', phone: '+37499112233', email: 'irina.k@example.com' },
  { name: 'Дмитрий Орлов', phone: '+37499223344' },
  { name: 'Анна Белова', phone: '+37499334455', notes: 'Просит не использовать ароматы.' },
  { name: 'Екатерина Морозова', phone: '+37499445566' },
  { name: 'Lia Petrosyan', phone: '+37433123456' },
  { name: 'Milena Davtyan', phone: '+37433234567' },
  { name: 'Hayk Arshakyan', phone: '+37433345678' },
  { name: 'Diana Movsisyan', phone: '+37444112233' },
  { name: 'Liana Abgaryan', phone: '+37444223344' },
  { name: 'Eva Tumanyan', phone: '+37444334455' },
  { name: 'Mher Ghazaryan', phone: '+37444445566' },
];

/** Walk-ins booked at the desk with no phone — they get no CRM client row. */
export const WALK_INS = ['Walk-in client', 'Anna (walk-in)', 'Գուրգեն', 'Сергей'];

/** Short staff notes that land on some bookings. */
export const BOOKING_NOTES = [
  'First visit',
  'Asked for the quiet room',
  'Bring previous treatment photos',
  'Running 10 min late — called ahead',
  'Առաջին այց',
  'Պատվիրել է նույն վարպետին',
  'Просила напомнить за день',
  'Оплата картой',
];

/** Review copy by star rating, in all three languages. Empty = stars only. */
export const REVIEW_TEXT: Record<1 | 2 | 3 | 4 | 5, string[]> = {
  5: [
    'Absolutely loved it — I will be back!',
    'Very professional and gentle. Highly recommend.',
    'The result exceeded my expectations.',
    'Clean, calm and on time. Perfect.',
    'Շատ գոհ եմ, անպայման կգամ նորից։',
    'Իսկական պրոֆեսիոնալ է, շնորհակալություն։',
    'Արդյունքը գերազանցեց սպասելիքներս։',
    'Մաքուր, հանգիստ և ճշտապահ։ Խորհուրդ եմ տալիս։',
    'Всё понравилось, обязательно приду ещё!',
    'Настоящий профессионал, очень аккуратно.',
    'Результат превзошёл ожидания, спасибо!',
    'Чисто, уютно и без опозданий. Рекомендую.',
    '',
    '',
  ],
  4: [
    'Great result, though I waited about ten minutes.',
    'Very good — a bit pricey, but worth it.',
    'Լավ էր, բայց մի քիչ սպասեցի։',
    'Արդյունքը լավն է, գինը՝ մի փոքր բարձր։',
    'Хорошо, но пришлось немного подождать.',
    'Отличный результат, но цена кусается.',
    '',
  ],
  3: ['Okay overall, I expected a bit more.', 'Նորմալ էր, ավելին էի սպասում։', 'В целом нормально, ожидала большего.'],
  2: ['Not great this time — the appointment started late.', 'В этот раз не очень — начали с опозданием.'],
  1: ['Չհավանեցի, կես ժամ ուշացան։'],
};

/** Display names reviewers leave; '' renders as "Anonymous". */
export const REVIEW_AUTHORS = [
  'Maria H.', 'Lilit', 'Sona G.', 'Anahit', 'Tigran M.', 'Elena', 'Armine K.', 'Ani B.',
  'Լիլիթ', 'Մարիամ', 'Արմեն Ս.', 'Գայանե', 'Анна', 'Ирина К.', 'Ольга', 'Дмитрий',
  '', '', '',
];

/** Course members. Phones are unique within a run (the DB enforces it). */
export const MEMBERS: Person[] = [
  { name: 'Hayk Sargsyan', phone: '+37494101010', email: 'hayk.s@example.com' },
  { name: 'Ruzanna Ohanyan', phone: '+37494101011' },
  { name: 'Vahe Danielyan', phone: '+37494101012' },
  { name: 'Nune Baghdasaryan', phone: '+37494101013', email: 'nune.b@example.com' },
  { name: 'Karen Voskanyan', phone: '+37494101014' },
  { name: 'Astghik Hovsepyan', phone: '+37494101015' },
  { name: 'Lilit Karapetyan', phone: '+37494101016', email: 'lilit.karapetyan@example.com' },
  { name: 'Marine Avetisyan', phone: '+37494101017' },
  { name: 'Hermine Sahakyan', phone: '+37494101018' },
  { name: 'Anush Galstyan', phone: '+37494101019' },
  { name: 'Siranush Petrosyan', phone: '+37494101020' },
  { name: 'Arevik Muradyan', phone: '+37494101021' },
  { name: 'Մարիամ Աբրահամյան', phone: '+37494101022' },
  { name: 'Լուսինե Հարությունյան', phone: '+37494101023' },
  { name: 'Ольга Никитина', phone: '+37494101024', email: 'olga.n@example.com' },
  { name: 'Мария Соколова', phone: '+37494101025' },
  { name: 'Tamara Grigoryan', phone: '+37494101026' },
  { name: 'Narine Mkrtchyan', phone: '+37494101027' },
];

/** Board applicants without an account (the professionals seed provides the rest). */
export interface Applicant extends Person {
  note: string;
  locale: 'hy' | 'ru' | 'en';
}

export const APPLICANTS: Applicant[] = [
  { name: 'Armine Petrosyan', phone: '+37495201001', note: 'Five years in a clinic, certified for Candela and Alma lasers.', locale: 'en' },
  { name: 'Gohar Sargsyan', phone: '+37495201002', email: 'gohar.s@example.com', note: 'Ունեմ 3 տարվա փորձ և սեփական հաճախորդների բազա։', locale: 'hy' },
  { name: 'Мариам Акопян', phone: '+37495201003', note: 'Опыт 4 года, могу выйти с понедельника.', locale: 'ru' },
  { name: 'Lusine Grigoryan', phone: '+37495201004', note: 'Looking for a full-time position close to Arabkir.', locale: 'en' },
  { name: 'Նարե Մանուկյան', phone: '+37495201005', note: 'Վերջերս ավարտել եմ դասընթացը, պատրաստ եմ սովորել։', locale: 'hy' },
  { name: 'Ani Hovhannisyan', phone: '+37495201006', email: 'ani.hov@example.com', note: 'Portfolio on Instagram, happy to do a trial day.', locale: 'en' },
  { name: 'Тигран Саркисян', phone: '+37495201007', note: 'Барбер 6 лет, работал в Москве. Свои инструменты.', locale: 'ru' },
  { name: 'Davit Melkonyan', phone: '+37495201008', note: 'Evenings and weekends only.', locale: 'en' },
  { name: 'Մերի Խաչատրյան', phone: '+37495201009', note: 'Կարող եմ աշխատել հերթափոխով։', locale: 'hy' },
  { name: 'Sofia Avagyan', phone: '+37495201010', note: 'Administrator experience at a dental clinic, fluent EN/RU.', locale: 'en' },
  { name: 'Елена Варданян', phone: '+37495201011', note: 'Есть медицинское образование и сертификаты.', locale: 'ru' },
  { name: 'Mane Asatryan', phone: '+37495201012', note: 'I can bring 30+ regular clients with me.', locale: 'en' },
  { name: 'Արթուր Գասպարյան', phone: '+37495201013', note: 'Փնտրում եմ աթոռ վարձով, ունեմ սեփական հաճախորդներ։', locale: 'hy' },
  { name: 'Victoria Simonyan', phone: '+37495201014', note: 'Lash artist, classic + volume, 2 years.', locale: 'en' },
  { name: 'Кристина Галстян', phone: '+37495201015', note: 'Ищу стабильную работу с официальным оформлением.', locale: 'ru' },
  { name: 'Hripsime Baghdasaryan', phone: '+37495201016', note: 'Makeup artist for weddings and photo shoots.', locale: 'en' },
  { name: 'Լիանա Սիմոնյան', phone: '+37495201017', note: 'Մատնահարդար եմ, 4 տարվա փորձով։', locale: 'hy' },
  { name: 'Sargis Hakobyan', phone: '+37495201018', note: 'Night shifts are fine for me.', locale: 'en' },
];

/** Leads from the public "Book a demo" form (internal console → Demo requests). */
export const DEMO_REQUESTS = [
  { name: 'Lilit Sahakyan', company: 'Bloom Nail Bar', phone: '+374 91 45 67 89', email: 'lilit@bloom.example', notes: 'We have two branches and want online booking plus an Instagram link.', hoursAgo: 2, status: 'new' as const },
  { name: 'Арсен Геворгян', company: 'Arsen’s Barbershop', phone: '+374 93 22 44 66', email: '', notes: 'Хотим попробовать онлайн-запись, у нас 4 мастера.', hoursAgo: 26, status: 'new' as const },
  { name: 'Anna Petrosyan', company: 'Skin Lab Clinic', phone: '', email: 'anna@skinlab.example', notes: 'Interested in the courses module for our academy.', hoursAgo: 75, status: 'new' as const },
  { name: 'Կարեն Հովսեփյան', company: 'Spa Ararat', phone: '+374 94 11 22 33', email: 'karen@spa-ararat.example', notes: 'Demo done, pricing sent.', hoursAgo: 190, status: 'done' as const },
];

/** Every email the seed creates outside a partner, so `clean` can find them again. */
export const DEMO_REQUEST_EMAILS = DEMO_REQUESTS.map((d) => d.email).filter(Boolean);
export const DEMO_REQUEST_NAMES = DEMO_REQUESTS.map((d) => d.name);
