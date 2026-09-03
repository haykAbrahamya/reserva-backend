import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { VACANCY_PERKS } from '@/modules/vacancies/vacancy-perks';

/**
 * The public board's query contract.
 *
 * Every filter is a LIST, because a job seeker never wants exactly one district
 * or exactly one pay model — "Arabkir or Kentron, rent or percentage" is the
 * normal question. Accepting `?area=a&area=b` and `?area=a,b` interchangeably
 * keeps the query string short enough to share and lets the frontend build it
 * from an array without special-casing the single-value case.
 */

const MAX_LIST = 40;

/** A repeatable key param, tolerant of both `?k=a&k=b` and `?k=a,b`. */
const keyList = (max = MAX_LIST) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v): string[] => {
      if (v == null) return [];
      const raw = Array.isArray(v) ? v : [v];
      const out = raw
        .flatMap((x) => x.split(','))
        .map((x) => x.trim())
        .filter(Boolean);
      // De-duplicated so a sloppy client cannot turn one filter into a 500-item
      // IN clause, and capped so it cannot do it deliberately.
      return [...new Set(out)].slice(0, max);
    });

/** The same, restricted to a known set — anything unrecognized is dropped
 *  rather than rejected, so an old bookmark keeps working after a rename. */
const enumList = <T extends string>(values: readonly T[]) =>
  keyList().transform((list) => list.filter((v): v is T => (values as readonly string[]).includes(v)));

const PAY_TYPES = ['percentage', 'rent', 'salary', 'negotiable'] as const;
const EXPERIENCE = ['any', 'junior', 'experienced'] as const;
const SCHEDULES = ['full_time', 'part_time', 'shift', 'flexible'] as const;

export type BoardPayType = (typeof PAY_TYPES)[number];

/** Whole AMD — this currency has no minor unit, same as Service.price. */
const money = z.coerce.number().int().min(0).max(100_000_000).optional();
/** The salon's share of a commission split, 0-100. */
const percent = z.coerce.number().int().min(0).max(100).optional();

export const boardQuerySchema = z.object({
  /** Free text over the headline, the description and the salon's name. */
  q: z.string().trim().max(140).optional(),

  /** Area keys. A city and its districts are both valid keys; the frontend
   *  expands "Yerevan" into its districts so this stays a flat IN list. */
  area: keyList(),
  specialty: keyList(),
  /** Whole specialty groups ("Hair"), for the broad first cut. */
  group: keyList(),
  salon: keyList(),

  payType: enumList(PAY_TYPES),
  /**
   * Money is THREE independent ranges, not one.
   *
   * A salary, a chair rent and the salon's commission are different questions
   * on different scales — a 40,000 rent and a 400,000 salary on one slider
   * makes both unusable — and each range applies only to listings of its own
   * pay type. Every bound is optional: an open end means "no limit that way",
   * which is what a range control sitting at its extreme should mean.
   */
  salaryMin: money,
  salaryMax: money,
  rentMin: money,
  rentMax: money,
  percentMin: percent,
  percentMax: percent,

  experience: enumList(EXPERIENCE),
  schedule: enumList(SCHEDULES),
  /** Must-haves, ANDed: asking for "materials included" and "own client base
   *  not required" means both, not either. */
  perks: enumList(VACANCY_PERKS),

  sort: z.enum(['newest', 'pay_high', 'pay_low']).default('newest'),

  page: z.coerce.number().int().min(1).default(1),
  /** A board shows cards, not table rows — 12 fills a three-column grid
   *  exactly and 48 is the most one "load more" should ever fetch. */
  pageSize: z.coerce.number().int().min(1).max(48).default(12),
});
export class BoardQueryDto extends createZodDto(boardQuerySchema) {}
export type BoardQuery = z.infer<typeof boardQuerySchema>;

/**
 * An application from the public board.
 *
 * Name and phone only: this is an unauthenticated form on a page a stranger
 * found through a search engine, and every extra required field is someone who
 * doesn't apply. Email and a message are optional because some people want to
 * say more than a phone number can carry.
 */
export const applySchema = z.object({
  name: z.string().trim().min(2).max(120),
  /** Validated loosely and normalized server-side, matching the public booking
   *  and course-registration forms. */
  phone: z.string().trim().min(4).max(40),
  email: z.string().trim().email().max(160).or(z.literal('')).default(''),
  note: z.string().trim().max(1200).default(''),
  /** The language they applied in, so the salon calls back in it. */
  locale: z.enum(['en', 'hy', 'ru']).default('hy'),
});
export class ApplyDto extends createZodDto(applySchema) {}
