import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { paginationSchema } from '@/common/dto/pagination';
import { localizedTextSchema } from '@/common/schemas/localized';
import { VACANCY_PERKS } from '../vacancy-perks';

/** Whole AMD, matching Service.price — this currency has no minor unit. */
const MAX_AMOUNT = 100_000_000;

const payTypeSchema = z.enum(['percentage', 'rent', 'salary', 'negotiable']);
type PayType = z.infer<typeof payTypeSchema>;

const vacancyFields = z.object({
  /** Which branch the position is at. Required — a position with no address
   *  cannot be listed, filtered by city, or put on a map. */
  locationId: z.string().trim().min(1),
  specialtyKey: z.string().trim().min(1),

  /** Optional headline; falls back to the specialty's role name. Required when
   *  specialtyKey is 'other' (see requireTitleForOther). */
  title: z.string().trim().max(140).default(''),
  titleI18n: localizedTextSchema,
  description: z.string().trim().max(6000).default(''),
  descriptionI18n: localizedTextSchema,

  seats: z.number().int().min(1).max(99).default(1),

  // ── Terms ──
  payType: payTypeSchema.default('negotiable'),
  /** The share the SALON keeps. Named for the salon so "60/40" is never
   *  ambiguous anywhere in the stack. */
  salonPercent: z.number().int().min(0).max(100).nullable().optional(),
  salonPercentMax: z.number().int().min(0).max(100).nullable().optional(),
  amount: z.number().int().min(0).max(MAX_AMOUNT).nullable().optional(),
  amountMax: z.number().int().min(0).max(MAX_AMOUNT).nullable().optional(),
  payPeriod: z.enum(['day', 'week', 'month']).default('month'),

  // ── The work ──
  scheduleType: z.enum(['full_time', 'part_time', 'shift', 'flexible']).nullable().optional(),
  scheduleNote: z.string().trim().max(200).default(''),
  experience: z.enum(['any', 'junior', 'experienced']).default('any'),
  perks: z.array(z.enum(VACANCY_PERKS)).max(VACANCY_PERKS.length).default([]),

  // ── Contact ──
  applyMode: z.enum(['in_app', 'phone', 'both']).default('both'),
  contactPhone: z.string().trim().max(40).default(''),
});

/**
 * 'other' exists so a salon can advertise something the taxonomy doesn't cover
 * (a role, a trade, a one-off). Without a title such a listing would render as
 * literally "Other", so the free text becomes mandatory exactly there.
 */
const requireTitleForOther = (
  v: { specialtyKey?: string; title?: string },
  ctx: z.RefinementCtx,
) => {
  if (v.specialtyKey === 'other' && !v.title?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['title'],
      message: 'Give the position a title when the category is "Other"',
    });
  }
};

/**
 * Each pay type needs its own number, and a range must not run backwards.
 * Checks fire only when the fields are actually present, so a partial update
 * touching neither still passes.
 */
const validateTerms = (
  v: {
    payType?: PayType;
    salonPercent?: number | null;
    salonPercentMax?: number | null;
    amount?: number | null;
    amountMax?: number | null;
  },
  ctx: z.RefinementCtx,
) => {
  if (v.payType === 'percentage' && v.salonPercent == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['salonPercent'],
      message: 'Set the percentage the salon keeps',
    });
  }
  if ((v.payType === 'rent' || v.payType === 'salary') && v.amount == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: 'Set an amount' });
  }
  if (v.salonPercent != null && v.salonPercentMax != null && v.salonPercentMax < v.salonPercent) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['salonPercentMax'],
      message: 'The upper end of the range must not be lower than the lower end',
    });
  }
  if (v.amount != null && v.amountMax != null && v.amountMax < v.amount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['amountMax'],
      message: 'The upper end of the range must not be lower than the lower end',
    });
  }
};

/**
 * Clear the numbers that don't belong to the chosen pay type, the same way
 * course prices are normalized. Without this, switching a listing from rent to
 * percentage would leave the old rent lying in the row, ready to be rendered by
 * any future reader that forgets to check `payType` first.
 */
const normalizeTerms = <
  T extends {
    payType?: PayType;
    salonPercent?: number | null;
    salonPercentMax?: number | null;
    amount?: number | null;
    amountMax?: number | null;
  },
>(
  v: T,
): T => {
  if (!v.payType) return v;
  if (v.payType === 'percentage') return { ...v, amount: null, amountMax: null };
  if (v.payType === 'rent' || v.payType === 'salary') {
    return { ...v, salonPercent: null, salonPercentMax: null };
  }
  // negotiable — terms exist but are not published.
  return { ...v, salonPercent: null, salonPercentMax: null, amount: null, amountMax: null };
};

export const createVacancySchema = vacancyFields
  .superRefine(requireTitleForOther)
  .superRefine(validateTerms)
  .transform(normalizeTerms);
export class CreateVacancyDto extends createZodDto(createVacancySchema) {}

export const updateVacancySchema = vacancyFields
  .partial()
  .superRefine(requireTitleForOther)
  .superRefine(validateTerms)
  .transform(normalizeTerms);
export class UpdateVacancyDto extends createZodDto(updateVacancySchema) {}

/**
 * Lifecycle transitions, as verbs rather than a raw status field — the server
 * owns the timestamps that go with each one (`publishedAt`, `closedAt`,
 * `expiresAt`), so a client cannot set a status without them.
 */
export const vacancyActionSchema = z.object({
  action: z.enum(['publish', 'pause', 'close', 'renew']),
});
export class VacancyActionDto extends createZodDto(vacancyActionSchema) {}

export const listVacancyQuerySchema = paginationSchema.extend({
  /** 'live' folds published + paused together — the default working view. */
  status: z.enum(['all', 'draft', 'published', 'paused', 'closed', 'expired']).default('all'),
  locationId: z.string().trim().min(1).optional(),
  specialtyKey: z.string().trim().min(1).optional(),
  search: z.string().trim().max(140).optional(),
});
export class ListVacancyQueryDto extends createZodDto(listVacancyQuerySchema) {}
