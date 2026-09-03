import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AppException } from '@/common/errors/app.exception';
import { paginate } from '@/common/dto/pagination';
import { VACANCY_PERKS } from '@/modules/vacancies/vacancy-perks';
import { liveVacancyWhere } from '@/modules/vacancies/vacancy-visibility';
import { CARD_SELECT, DETAIL_SELECT, cardView, detailView } from './board.view';
import type { BoardPayType, BoardQuery } from './dto/board.dto';

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
    const where = this.buildWhere(q);

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

  private buildWhere(q: BoardQuery): Prisma.VacancyWhereInput {
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
      // Free text stays on the listing's own words and the salon's name. Role
      // and place names are deliberately NOT searched here: the client holds
      // the entire specialty and area catalog, aliases included, so it resolves
      // "kolorist" or "davtashen" into real keys and sends those as filters.
      // That is faster, and it finds listings whose author never typed the word.
      filters.push({
        OR: [
          { title: { contains: q.q, mode: 'insensitive' } },
          { description: { contains: q.q, mode: 'insensitive' } },
          { partner: { name: { contains: q.q, mode: 'insensitive' } } },
        ],
      });
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
