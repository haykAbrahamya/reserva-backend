import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { paginate } from '@/common/dto/pagination';
import { VACANCY_PERKS } from '@/modules/vacancies/vacancy-perks';
import { liveVacancyWhere } from '@/modules/vacancies/vacancy-visibility';
import { CARD_SELECT, DETAIL_SELECT, cardView, detailView } from './board.view';
import type { BoardPayType, BoardQuery } from './dto/board.dto';

/**
 * Below this, a free-text query is not resolved against the role and place
 * catalogs: one character matches most of a catalog and narrows nothing.
 */
const MIN_CATALOG_SEARCH_LENGTH = 2;

/**
 * Ceiling on the id list gathered from translated titles. Generous enough that
 * no realistic board reaches it, present so the IN (...) list cannot grow
 * without bound as the board does.
 */
const I18N_MATCH_CAP = 2000;

/** How many other listings from the same salon the detail page offers. */
const MORE_FROM_SALON = 4;

/**
 * The public vacancies board (vacancies.reserva.am).
 *
 * Unauthenticated and read-mostly, which makes the base predicate the most
 * important thing in the file: four independent conditions must all hold before
 * a listing is visible to a stranger, and every query here starts from it.
 */
@Injectable()
export class BoardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * What is visible to a stranger. Defined once with the domain, in
   * vacancies/vacancy-visibility.ts, because the apply endpoint has to accept
   * on exactly the same terms this lists on.
   */
  private liveWhere(now = new Date()): Prisma.VacancyWhereInput {
    return liveVacancyWhere(now);
  }

  // -- list --------------------------------------------------

  async list(q: BoardQuery) {
    const where = await this.buildWhere(q);

    const [rows, total] = await Promise.all([
      this.prisma.vacancy.findMany({
        where,
        select: CARD_SELECT,
        orderBy: orderFor(q.sort),
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.vacancy.count({ where }),
    ]);

    return paginate(rows.map(cardView), total, q.page, q.pageSize);
  }

  /**
   * One listing, plus a few more from the same salon.
   *
   * The siblings are the cheapest useful thing on the page: a salon advertising
   * one chair usually advertises three, and the person who just opened one is
   * the likeliest person to want the others.
   */
  async get(id: string) {
    const row = await this.prisma.vacancy.findFirst({
      where: { AND: [{ id }, this.liveWhere()] },
      select: DETAIL_SELECT,
    });
    if (!row) throw AppException.notFound('This listing is no longer available');

    const more = await this.prisma.vacancy.findMany({
      where: { AND: [{ partnerId: row.partner.id }, { id: { not: id } }, this.liveWhere()] },
      select: CARD_SELECT,
      orderBy: { publishedAt: 'desc' },
      take: MORE_FROM_SALON,
    });

    return { vacancy: detailView(row), moreFromSalon: more.map(cardView) };
  }

  // -- filter facets -----------------------------------------

  /**
   * Everything the filter panel needs to draw itself: which options have
   * listings behind them, and the real bounds for the money controls.
   *
   * Counted over the whole live board rather than the visitor's current
   * selection. That is deliberate — a true faceted count (each option counted
   * as if its own filter were lifted) costs an aggregation per facet, and the
   * number a visitor actually acts on is the result total, which IS filtered.
   * These counts answer "what is on this board at all", the orientation
   * question a first-time visitor has.
   *
   * Aggregated in the application rather than by SQL GROUP BY because a single
   * pass over a few thousand narrow rows produces every facet at once, where
   * grouping would need six round trips. Worth revisiting past roughly 50k live
   * listings, at which point this becomes six GROUP BYs over the same index.
   */
  async meta() {
    const rows = await this.prisma.vacancy.findMany({
      where: this.liveWhere(),
      select: {
        partnerId: true,
        specialtyKey: true,
        payType: true,
        amount: true,
        amountMax: true,
        salonPercent: true,
        salonPercentMax: true,
        perks: true,
        experience: true,
        scheduleType: true,
        specialty: { select: { groupKey: true } },
        location: { select: { areaKey: true, area: { select: { parentKey: true } } } },
      },
    });

    const areas = new Counter();
    const specialties = new Counter();
    const groups = new Counter();
    const salons = new Counter();
    const payTypes = new Counter();
    const experience = new Counter();
    const schedule = new Counter();
    const perks = new Counter();

    // Bounds tracked PER pay type: one shared min/max across salaries and rents
    // would put a 40,000 chair rent and a 400,000 salary on the same scale and
    // make both controls useless.
    const salary = new Bounds();
    const rent = new Bounds();
    const percent = new Bounds();

    for (const r of rows) {
      const areaKey = r.location.areaKey;
      if (areaKey) {
        areas.add(areaKey);
        // A district's listing also counts towards its city, so "Yerevan (86)"
        // is true without the client summing 12 districts itself.
        const parentKey = r.location.area?.parentKey;
        if (parentKey) areas.add(parentKey);
      }
      specialties.add(r.specialtyKey);
      groups.add(r.specialty.groupKey);
      salons.add(r.partnerId);
      payTypes.add(r.payType);
      experience.add(r.experience);
      if (r.scheduleType) schedule.add(r.scheduleType);
      for (const p of r.perks) perks.add(p);

      if (r.payType === 'salary') salary.seen(r.amount, r.amountMax);
      if (r.payType === 'rent') rent.seen(r.amount, r.amountMax);
      if (r.payType === 'percentage') percent.seen(r.salonPercent, r.salonPercentMax);
    }

    // Only salons with something live, and only the fields a filter row needs.
    // Ordered by listing count: the salon someone is looking for by name is
    // usually the one hiring most.
    const salonIds = salons.keys();
    const salonRows = salonIds.length
      ? await this.prisma.partner.findMany({
          where: { id: { in: salonIds } },
          select: {
            id: true,
            slug: true,
            name: true,
            nameI18n: true,
            accent: true,
            presentation: { select: { logoUrl: true } },
          },
        })
      : [];

    return {
      total: rows.length,
      areas: areas.entries(),
      specialties: specialties.entries(),
      groups: groups.entries(),
      payTypes: payTypes.entries(),
      experience: experience.entries(),
      schedule: schedule.entries(),
      perks: perks.entries(),
      /** The full perk vocabulary, so the panel can order and label perks that
       *  nothing currently offers instead of hiding them inconsistently. */
      perkVocabulary: [...VACANCY_PERKS],
      salons: salonRows
        .map((p) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          nameI18n: p.nameI18n,
          accent: p.accent,
          logoUrl: p.presentation?.logoUrl || null,
          count: salons.get(p.id),
        }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      pay: { salary: salary.result(), rent: rent.result(), percent: percent.result() },
    };
  }

  // -- where builder -----------------------------------------

  /**
   * Resolve free text against the things a card actually displays but the
   * vacancy row does not store: catalog role names, catalog place names, and
   * the localized title/description blobs.
   *
   * Raw SQL rather than Prisma filters, because all three live in `jsonb` or in
   * a `text[]` of aliases, and Prisma's JSON filters are case-SENSITIVE —
   * useless for a search box, where someone typing "կոլորիստ" must find
   * "Կոլորիստ". Postgres `ILIKE` on an extracted path is case-insensitive in
   * every script, Armenian included.
   *
   * Extracted paths (`->>'hy'`) rather than casting the whole blob to text: a
   * two-letter query like "ru" would otherwise match the KEY of every row's
   * translation object and return the entire board.
   */
  private async textMatches(text: string): Promise<{
    specialtyKeys: string[];
    areaKeys: string[];
    vacancyIds: string[];
  }> {
    const term = text.trim();
    // One character matches nearly everything and answers nothing. The base
    // columns are still searched for it by the caller's Prisma clause.
    if (term.length < MIN_CATALOG_SEARCH_LENGTH) {
      return { specialtyKeys: [], areaKeys: [], vacancyIds: [] };
    }

    // `%` and `_` are LIKE wildcards; a reader typing them means the characters.
    const pattern = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

    const [specialties, areas, vacancies] = await Promise.all([
      this.prisma.$queryRaw<{ key: string }[]>`
        SELECT "key" FROM "specialties"
        WHERE "active"
          AND ("name" ILIKE ${pattern}
            OR "roleName" ILIKE ${pattern}
            OR "nameI18n"->>'hy' ILIKE ${pattern}
            OR "nameI18n"->>'ru' ILIKE ${pattern}
            OR "roleNameI18n"->>'hy' ILIKE ${pattern}
            OR "roleNameI18n"->>'ru' ILIKE ${pattern}
            OR EXISTS (SELECT 1 FROM unnest("aliases") a WHERE a ILIKE ${pattern}))
      `,
      this.prisma.$queryRaw<{ key: string }[]>`
        SELECT "key" FROM "areas"
        WHERE "active"
          AND ("name" ILIKE ${pattern}
            OR "nameI18n"->>'hy' ILIKE ${pattern}
            OR "nameI18n"->>'ru' ILIKE ${pattern}
            OR EXISTS (SELECT 1 FROM unnest("aliases") a WHERE a ILIKE ${pattern}))
      `,
      /*
       * Ids, not a predicate, because this cannot be expressed as a Prisma
       * `where` and still be case-insensitive. Capped: the result feeds an
       * `IN (...)` list, and an unbounded one would grow with the board. The
       * cap only ever drops listings that matched on a TRANSLATED title while
       * matching nothing else, which is the narrowest slice of any search.
       */
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT v."id" FROM "vacancies" v
        WHERE v."deletedAt" IS NULL
          AND v."status" = 'published'
          AND (v."titleI18n"->>'hy' ILIKE ${pattern}
            OR v."titleI18n"->>'ru' ILIKE ${pattern}
            OR v."descriptionI18n"->>'hy' ILIKE ${pattern}
            OR v."descriptionI18n"->>'ru' ILIKE ${pattern}
            OR EXISTS (
              SELECT 1 FROM "partners" p
              WHERE p."id" = v."partnerId"
                AND (p."nameI18n"->>'hy' ILIKE ${pattern}
                  OR p."nameI18n"->>'ru' ILIKE ${pattern})))
        LIMIT ${I18N_MATCH_CAP}
      `,
    ]);

    return {
      specialtyKeys: specialties.map((r) => r.key),
      areaKeys: areas.map((r) => r.key),
      vacancyIds: vacancies.map((r) => r.id),
    };
  }

  private async buildWhere(q: BoardQuery): Promise<Prisma.VacancyWhereInput> {
    const filters: Prisma.VacancyWhereInput[] = [this.liveWhere()];

    /*
     * An area key means that area OR anything inside it.
     *
     * This is load-bearing. Branches in Yerevan are tagged with a DISTRICT key
     * ("yerevan-arabkir"), never with "yerevan" itself — while branches in
     * Gyumri carry the city key directly, because a city with no districts has
     * nothing below it. So a plain `areaKey IN ('yerevan')` matched no branch at
     * all, and the facet count said 20: the panel offered "Yerevan (20)" and
     * clicking it returned nothing.
     *
     * Expanded here rather than in the client so the two cannot disagree, and
     * so a shared link stays short — `?area=yerevan` rather than its twelve
     * districts spelled out. One level deep is the entire taxonomy, so this is
     * a plain OR on the joined row and not a recursive query.
     */
    if (q.area.length) {
      filters.push({
        location: {
          area: { OR: [{ key: { in: q.area } }, { parentKey: { in: q.area } }] },
        },
      });
    }
    if (q.specialty.length) filters.push({ specialtyKey: { in: q.specialty } });
    if (q.group.length) filters.push({ specialty: { groupKey: { in: q.group } } });
    if (q.salon.length) filters.push({ partnerId: { in: q.salon } });
    if (q.experience.length) filters.push({ experience: { in: q.experience } });
    if (q.schedule.length) filters.push({ scheduleType: { in: q.schedule } });
    // hasEvery, not hasSome: ticking two must-haves means both of them.
    if (q.perks.length) filters.push({ perks: { hasEvery: q.perks } });

    const pay = payWhere(q);
    if (pay) filters.push(pay);

    if (q.q) {
      /*
       * Free text has to reach the words the READER can see, which are mostly
       * not on the vacancy row.
       *
       * This clause used to cover `title`, `description` and the salon name
       * only, on the theory that the client would resolve role and place names
       * against its own catalog and send keys instead. It never did — and even
       * if it had, two thirds of the board would still have been unreachable:
       *
       *  - a listing with no title of its own renders `specialty.roleName`
       *    (20 of 31 live listings do), and that word lives in the catalog
       *  - a listing WITH a title shows its localized variant from `titleI18n`,
       *    while only the base `title` column was being matched
       *
       * So searching "Մատնահարդար" — a word plainly printed on a card — matched
       * nothing at all. Both are resolved server-side now, in one place, so a
       * shared link finds the same listings the person who sent it saw.
       */
      const { specialtyKeys, areaKeys, vacancyIds } = await this.textMatches(q.q);

      /*
       * Prisma's `contains` drops the term into a LIKE pattern WITHOUT escaping
       * it, so a typed `%` really is a wildcard: searching "%" returned the
       * entire board, which reads as "search ignored my input". The raw queries
       * above escape properly; these three cannot, so the wildcards are removed
       * from the term they see instead. "50%" still finds a title containing
       * "50" — marginally broader, never wrong — and a query that was ONLY
       * wildcards leaves nothing to match, which must not become `contains: ''`
       * (that matches every row).
       */
      const literal = q.q.replace(/[%_]/g, '');
      const baseColumns: Prisma.VacancyWhereInput[] = literal
        ? [
            { title: { contains: literal, mode: 'insensitive' } },
            { description: { contains: literal, mode: 'insensitive' } },
            { partner: { name: { contains: literal, mode: 'insensitive' } } },
          ]
        : [];

      const textClauses: Prisma.VacancyWhereInput[] = [
          ...baseColumns,
          // A matched role, e.g. "Մատնահարդար" / "маникюрша" / "nail master".
          ...(specialtyKeys.length ? [{ specialtyKey: { in: specialtyKeys } }] : []),
          // A matched place, expanded to its children exactly as the area
          // FILTER does — otherwise typing "Երևան" and clicking "Yerevan"
          // would return different listings.
          ...(areaKeys.length
            ? [
                {
                  location: {
                    area: { OR: [{ key: { in: areaKeys } }, { parentKey: { in: areaKeys } }] },
                  },
                },
              ]
            : []),
          // Listings whose localized title/description matched.
          ...(vacancyIds.length ? [{ id: { in: vacancyIds } }] : []),
      ];

      /*
       * A search that matched nothing must return nothing.
       *
       * Prisma reads `OR: []` as "no constraint" and hands back the whole
       * board, so the one case where every clause dropped out — a query made
       * entirely of wildcards — silently became "show everything". The empty
       * `id in ()` is the explicit way to say no rows.
       */
      filters.push(
        textClauses.length ? { OR: textClauses } : { id: { in: [] } },
      );
    }

    return { AND: filters };
  }
}

/**
 * Sort order.
 *
 * `amount` carries a rent OR a salary, so a pay sort mixes the two whenever the
 * visitor has not narrowed the pay type — which is why the UI labels it as the
 * advertised figure rather than as salary. Listings with no figure (negotiable)
 * always sort last: they are the least informative card in either direction.
 */
function orderFor(sort: BoardQuery['sort']): Prisma.VacancyOrderByWithRelationInput[] {
  if (sort === 'pay_high') {
    return [{ amount: { sort: 'desc', nulls: 'last' } }, { publishedAt: 'desc' }];
  }
  if (sort === 'pay_low') {
    return [{ amount: { sort: 'asc', nulls: 'last' } }, { publishedAt: 'desc' }];
  }
  return [{ publishedAt: 'desc' }];
}

/**
 * Does a listing's advertised figure overlap the range the visitor asked for?
 *
 * A listing may advertise a single figure (`low` only) or a band
 * (`low`-`high`), and the visitor may leave either end of their range open. Two
 * intervals overlap when each starts at or before the other ends, which is the
 * only comparison that treats a "200,000-300,000" listing correctly: it should
 * answer both "at least 250,000" and "at most 250,000", and a naive test
 * against the lower figure alone gets one of those wrong.
 *
 * The high end needs the OR because SQL has no COALESCE here: a listing with no
 * upper figure is bounded by its lower one.
 */
function overlaps(
  low: 'amount' | 'salonPercent',
  high: 'amountMax' | 'salonPercentMax',
  min?: number,
  max?: number,
): Prisma.VacancyWhereInput {
  const clauses: Prisma.VacancyWhereInput[] = [];
  // listingHigh >= min
  if (min != null) {
    clauses.push({
      OR: [{ [high]: { gte: min } }, { AND: [{ [high]: null }, { [low]: { gte: min } }] }],
    } as Prisma.VacancyWhereInput);
  }
  // listingLow <= max
  if (max != null) clauses.push({ [low]: { lte: max } } as Prisma.VacancyWhereInput);
  return clauses.length ? { AND: clauses } : {};
}

/**
 * The money filter, as one OR over pay-type branches.
 *
 * Each branch pairs a pay type with the range that belongs to it, so the ranges
 * never leak across types: asking for a 150,000 rent ceiling must not hide
 * every salaried listing, which is exactly what one flat range would do.
 */
function payWhere(q: BoardQuery): Prisma.VacancyWhereInput | null {
  const constrained: Record<BoardPayType, boolean> = {
    salary: q.salaryMin != null || q.salaryMax != null,
    rent: q.rentMin != null || q.rentMax != null,
    percentage: q.percentMin != null || q.percentMax != null,
    negotiable: false,
  };

  // A money range implies its pay type. Someone who drags the salary slider is
  // asking for salaried work whether or not they also ticked the box, and the
  // alternative — accepting the range and then ignoring it — is worse.
  const implied = (Object.keys(constrained) as BoardPayType[]).filter((t) => constrained[t]);
  const chosen = q.payType.length ? q.payType : implied;
  if (!chosen.length) return null;

  const branches = chosen.map((t): Prisma.VacancyWhereInput => {
    if (t === 'salary') {
      return {
        payType: 'salary',
        ...overlaps('amount', 'amountMax', q.salaryMin, q.salaryMax),
      };
    }
    if (t === 'rent') {
      return { payType: 'rent', ...overlaps('amount', 'amountMax', q.rentMin, q.rentMax) };
    }
    if (t === 'percentage') {
      return {
        payType: 'percentage',
        ...overlaps('salonPercent', 'salonPercentMax', q.percentMin, q.percentMax),
      };
    }
    // Negotiable advertises no figure, so no range can narrow it — it is in or
    // out purely by whether the visitor asked for it.
    return { payType: 'negotiable' };
  });

  return { OR: branches };
}

/** Tally of key to count, kept out of the aggregation loop for readability. */
class Counter {
  private readonly map = new Map<string, number>();

  add(key: string) {
    this.map.set(key, (this.map.get(key) ?? 0) + 1);
  }

  get(key: string) {
    return this.map.get(key) ?? 0;
  }

  keys() {
    return [...this.map.keys()];
  }

  /** Sorted by count, so a panel can show the busiest options first. */
  entries(): { key: string; count: number }[] {
    return [...this.map.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  }
}

/**
 * Observed min/max for one money control.
 *
 * Returns null when nothing was seen, so the UI hides the control instead of
 * rendering a slider from 0 to 0 — a dead control reads as a broken one.
 */
class Bounds {
  private min: number | null = null;
  private max: number | null = null;

  seen(...values: (number | null)[]) {
    for (const v of values) {
      if (v == null) continue;
      this.min = this.min == null ? v : Math.min(this.min, v);
      this.max = this.max == null ? v : Math.max(this.max, v);
    }
  }

  result() {
    return this.min == null || this.max == null ? null : { min: this.min, max: this.max };
  }
}
